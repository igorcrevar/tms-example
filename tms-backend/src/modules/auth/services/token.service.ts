import { createHash, createHmac, randomUUID } from 'node:crypto';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, IsNull, LessThan, Repository } from 'typeorm';
import { fromUnixTime, isFuture } from 'date-fns';

import { AppConfig, AudienceSecrets } from '../../../config/app-config';
import { TokenType } from '../auth.constants';
import { RefreshToken, TokenAudience } from '../entities/refresh-token.entity';

export interface AccessClaims {
  role?: string;
  driverId?: string;
  driverType?: string;
}

export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
}

export interface IssuedSession {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
  refreshTokenId: string;
  familyId: string;
}

export interface MfaChallenge {
  userId: string;
  enrolmentRequired: boolean;
}

@Injectable()
export class TokenService {
  private readonly logger = new Logger(TokenService.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfig,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
  ) {}

  async issueSession(
    params: {
      userId: string;
      audience: TokenAudience;
      claims?: AccessClaims;
      familyId?: string;
      replacesTokenId?: string;
      context?: RequestContext;
    },
    mng: EntityManager,
  ): Promise<IssuedSession> {
    const { accessSecret, refreshSecret, accessTtl, refreshTtl } = this.secretsFor(params.audience);
    const familyId = params.familyId ?? randomUUID();
    const refreshTokenId = randomUUID();

    const accessToken = await this.jwt.signAsync(
      { sub: params.userId, typ: TokenType.Access, ...(params.claims ?? {}) },
      { secret: accessSecret, expiresIn: accessTtl, audience: params.audience },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: params.userId, typ: TokenType.Refresh, fam: familyId, jti: refreshTokenId },
      { secret: refreshSecret, expiresIn: refreshTtl, audience: params.audience },
    );

    const accessExpiresAt = this.expiryOf(accessToken);
    const refreshExpiresAt = this.expiryOf(refreshToken);

    const rows = mng.getRepository(RefreshToken);

    await rows.save(
      rows.create({
        id: refreshTokenId,
        familyId,
        userId: params.userId,
        audience: params.audience,
        tokenHash: this.hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: params.context?.userAgent?.slice(0, 255) ?? null,
        ipAddress: params.context?.ipAddress?.slice(0, 64) ?? null,
      }),
    );

    if (params.replacesTokenId) {
      await rows.update(params.replacesTokenId, { replacedByTokenId: refreshTokenId });
    }

    return {
      accessToken,
      accessExpiresAt,
      refreshToken,
      refreshExpiresAt,
      refreshTokenId,
      familyId,
    };
  }

  /**
   * Validates a refresh token and consumes it. Presenting an already-revoked
   * token means it leaked, so the whole family dies with it.
   */
  async consumeRefreshToken(
    rawToken: string,
    audience: TokenAudience,
    mng: EntityManager,
  ): Promise<{ userId: string; familyId: string; tokenId: string }> {
    const { refreshSecret } = this.secretsFor(audience);

    let payload: { sub?: string; typ?: string };
    try {
      payload = await this.jwt.verifyAsync(rawToken, { secret: refreshSecret, audience });
    } catch {
      throw new UnauthorizedException('Invalid session');
    }

    if (payload.typ !== TokenType.Refresh) {
      throw new UnauthorizedException('Invalid session');
    }

    const rows = mng.getRepository(RefreshToken);

    const stored = await rows.findOne({ where: { tokenHash: this.hashToken(rawToken) } });

    if (!stored || stored.audience !== audience) {
      throw new UnauthorizedException('Invalid session');
    }

    if (!stored.revokedAt && !isFuture(stored.expiresAt)) {
      throw new UnauthorizedException('Invalid session');
    }

    // Conditional claim rather than a check and then a write: a concurrent consumer blocks
    // on the row, re-reads it revoked, and is recognised as the replay it is.
    const claimed = await rows.update(
      { id: stored.id, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );

    if (claimed.affected !== 1) {
      // Deliberately off `mng`: the throw below rolls that transaction back, and the
      // revocation a replay earns has to outlive it.
      await this.revokeFamily(stored.familyId);
      this.logger.warn(
        `Refresh token reuse detected for user ${stored.userId}; revoked family ${stored.familyId}`,
      );
      throw new UnauthorizedException('Invalid session');
    }

    return { userId: stored.userId, familyId: stored.familyId, tokenId: stored.id };
  }

  /** Without a manager it commits on its own, for the paths that revoke and then throw. */
  async revokeFamily(familyId: string, mng?: EntityManager): Promise<void> {
    const rows = mng ? mng.getRepository(RefreshToken) : this.refreshTokens;

    await rows.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async revokeAllForUser(
    userId: string,
    audience: TokenAudience,
    mng: EntityManager,
  ): Promise<void> {
    await mng
      .getRepository(RefreshToken)
      .update({ userId, audience, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async purgeExpired(mng: EntityManager): Promise<number> {
    const result = await mng
      .getRepository(RefreshToken)
      .delete({ expiresAt: LessThan(new Date()) });

    return result.affected ?? 0;
  }

  createMfaChallenge(userId: string, enrolmentRequired: boolean): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, typ: TokenType.MfaChallenge, enrol: enrolmentRequired },
      {
        secret: this.mfaSecret(),
        expiresIn: this.config.auth.mfaChallengeTtl,
        audience: TokenAudience.Staff,
      },
    );
  }

  async verifyMfaChallenge(rawToken: string): Promise<MfaChallenge> {
    let payload: { sub?: string; typ?: string; enrol?: boolean };
    try {
      payload = await this.jwt.verifyAsync(rawToken, {
        secret: this.mfaSecret(),
        audience: TokenAudience.Staff,
      });
    } catch {
      throw new UnauthorizedException('Two-factor challenge expired');
    }

    if (payload.typ !== TokenType.MfaChallenge || !payload.sub) {
      throw new UnauthorizedException('Two-factor challenge expired');
    }

    return { userId: payload.sub, enrolmentRequired: Boolean(payload.enrol) };
  }

  private secretsFor(audience: TokenAudience): AudienceSecrets {
    return audience === TokenAudience.Staff ? this.config.auth.staff : this.config.auth.driver;
  }

  /** Distinct from every session secret without needing another env var. */
  private mfaSecret(): string {
    return createHmac('sha256', this.config.auth.staff.refreshSecret)
      .update('mfa-challenge')
      .digest('hex');
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  expiryOf(token: string): Date {
    const decoded: unknown = this.jwt.decode(token);
    const exp =
      typeof decoded === 'object' && decoded !== null && 'exp' in decoded ? decoded.exp : undefined;

    if (typeof exp !== 'number') {
      throw new Error('Signed token is missing an exp claim');
    }

    return fromUnixTime(exp);
  }
}
