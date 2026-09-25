import { createHash, randomBytes } from 'node:crypto';
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { addSeconds, isPast } from 'date-fns';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { AppConfig } from '../../../config/app-config';
import { MailService } from '../../mail/mail.service';
import { passwordResetEmail } from '../../mail/templates';
import { User, UserStatus } from '../../user/entities/user.entity';
import { AuthToken, AuthTokenPurpose } from '../entities/auth-token.entity';
import { TokenAudience } from '../entities/refresh-token.entity';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

/** One message for every failure so a caller cannot learn which tokens exist. */
const INVALID_TOKEN = 'This password reset link is no longer valid';

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @InjectRepository(AuthToken)
    private readonly authTokens: Repository<AuthToken>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly config: AppConfig,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Resolves the same way whether or not the address belongs to an account:
   * the caller must not be able to discover who is registered.
   */
  async request(email: string): Promise<void> {
    const user = await this.users.findOne({
      where: { email: email.trim().toLowerCase() },
      relations: { role: true },
    });

    // Drivers sign in with a PIN their dispatcher sets; they have no password path.
    if (!user || user.status !== UserStatus.Active || user.role?.pinLogin) {
      this.logger.warn('Skipping reset email: no active staff account for that address');
      return;
    }

    this.logger.log(`Issuing a password reset for user ${user.id}`);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = addSeconds(new Date(), this.config.passwordReset.ttlSeconds);

    await this.authTokens.save(
      this.authTokens.create({
        tokenHash: this.hash(token),
        purpose: AuthTokenPurpose.PasswordReset,
        userId: user.id,
        expiresAt,
      }),
    );

    const message = passwordResetEmail({
      firstName: user.firstName,
      resetUrl: this.buildResetUrl(token),
      expiresAt,
    });

    // Delivery stays off the request path: awaiting SMTP would widen the gap between a
    // known and an unknown address far past the token insert that already separates them.
    void this.mail.send({ to: user.email, ...message }).catch((error: unknown) => {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `Could not deliver the reset email for user ${user.id}: ${cause.message}`,
        cause.stack,
      );
    });
  }

  /**
   * Sets the new password and takes every existing session with it: a reset
   * must not leave a session an attacker already holds alive.
   */
  async reset(token: string, password: string): Promise<void> {
    const { userId, superseded } = await this.dataSource.transaction(async (manager) => {
      const reset = await this.findUsable(manager, token);
      // Hashing is the expensive step; an unauthenticated caller must not trigger it.
      const passwordHash = await this.passwords.hash(password);

      // Claiming this link and superseding its siblings in one statement: as two
      // statements, concurrent resets lock the same rows in opposite orders and deadlock.
      const claimed = await manager
        .createQueryBuilder()
        .update(AuthToken)
        .set({ usedAt: new Date() })
        .where('"userId" = :userId AND purpose = :purpose AND "usedAt" IS NULL', {
          userId: reset.userId,
          purpose: AuthTokenPurpose.PasswordReset,
        })
        .returning('id')
        .execute();

      const claimedIds = (claimed.raw as Array<{ id: string }>).map((row) => row.id);

      if (!claimedIds.includes(reset.id)) {
        throw new NotFoundException(INVALID_TOKEN);
      }

      await manager.update(
        User,
        { id: reset.userId },
        { passwordHash, failedLoginAttempts: 0, lockedUntil: null },
      );

      await this.tokens.revokeAllForUser(reset.userId, TokenAudience.Staff, manager);

      return { userId: reset.userId, superseded: claimedIds.length - 1 };
    });

    this.logger.log(
      `Reset the password for user ${userId}, cleared its lockout counters, revoked its staff ` +
        `sessions and invalidated ${superseded} other outstanding reset link(s)`,
    );
  }

  private async findUsable(manager: EntityManager, token: string): Promise<AuthToken> {
    const reset = await manager.findOne(AuthToken, {
      where: { tokenHash: this.hash(token), purpose: AuthTokenPurpose.PasswordReset },
      relations: { user: { role: true } },
    });

    if (!reset?.user || reset.usedAt || isPast(reset.expiresAt)) {
      throw new NotFoundException(INVALID_TOKEN);
    }

    if (reset.user.status !== UserStatus.Active || reset.user.role?.pinLogin) {
      throw new NotFoundException(INVALID_TOKEN);
    }

    return reset;
  }

  private buildResetUrl(token: string): string {
    return `${this.config.passwordReset.resetUrl}?token=${encodeURIComponent(token)}`;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
