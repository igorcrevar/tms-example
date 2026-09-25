import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { User, UserStatus } from '../../user/entities/user.entity';
import { TokenAudience } from '../entities/refresh-token.entity';
import { LockoutService } from './lockout.service';
import { PasswordService } from './password.service';
import { IssuedSession, MfaChallenge, RequestContext, TokenService } from './token.service';
import { TotpService } from './totp.service';

/** One message for every failure so responses never confirm an account exists. */
const INVALID_CREDENTIALS = 'Invalid credentials';

export interface StaffLoginResult {
  challengeToken: string;
  challengeExpiresAt: Date;
  enrolmentRequired: boolean;
}

export interface TotpEnrolment {
  secret: string;
  otpauthUri: string;
  qrDataUrl: string;
}

export interface StaffSession {
  session: IssuedSession;
  user: User;
}

@Injectable()
export class StaffAuthService {
  private readonly logger = new Logger(StaffAuthService.name);

  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly tokens: TokenService,
    private readonly lockout: LockoutService,
    private readonly dataSource: DataSource,
  ) {}

  async login(email: string, password: string): Promise<StaffLoginResult> {
    // The row is locked for the whole check so concurrent failures count one by one. A
    // throw inside would roll the failure write back, so the verdict is thrown after commit.
    const user = await this.dataSource.transaction(async (manager) => {
      const found = await this.findByEmailWithSecrets(email, manager);

      // PIN roles belong on the driver API; a password path must not exist for them.
      if (!found || !found.passwordHash || found.role?.pinLogin || this.lockout.isLocked(found)) {
        await this.passwords.verifyDummy(password);
        return null;
      }

      const passwordMatches = await this.passwords.verify(found.passwordHash, password);

      if (!passwordMatches || found.status !== UserStatus.Active) {
        await this.lockout.registerFailure(found, manager);
        return null;
      }

      await manager.update(User, found.id, { failedLoginAttempts: 0, lockedUntil: null });

      return found;
    });

    if (!user) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    const enrolmentRequired = user.totpEnabledAt === null;

    this.logger.log(
      `Password accepted for user ${user.id}; issuing two-factor challenge` +
        (enrolmentRequired ? ' and requiring enrolment' : ''),
    );

    const challengeToken = await this.tokens.createMfaChallenge(user.id, enrolmentRequired);

    return {
      challengeToken,
      challengeExpiresAt: this.tokens.expiryOf(challengeToken),
      enrolmentRequired,
    };
  }

  /** Stores a pending secret; it only becomes active once a code verifies. */
  async beginTotpEnrolment(challenge: MfaChallenge): Promise<TotpEnrolment> {
    const user = await this.users.findOne({ where: { id: challenge.userId } });

    if (!user || user.totpEnabledAt !== null) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    this.logger.log(`Generating a two-factor secret for user ${user.id}`);

    const secret = this.totp.generateSecret();
    await this.users.update(user.id, { totpSecret: secret });

    const otpauthUri = this.totp.buildUri(user.email, secret);

    return { secret, otpauthUri, qrDataUrl: await this.totp.buildQrDataUrl(otpauthUri) };
  }

  async completeLogin(
    challenge: MfaChallenge,
    code: string,
    context: RequestContext,
  ): Promise<StaffSession> {
    // Same shape as login: the row stays locked through the check, and a wrong code is
    // recorded inside the transaction but refused after it commits.
    const result = await this.dataSource.transaction(async (manager) => {
      const user = await this.findByIdWithSecrets(challenge.userId, manager);

      if (!user?.totpSecret || user.status !== UserStatus.Active || this.lockout.isLocked(user)) {
        return null;
      }

      if (!this.totp.verify(user.totpSecret, code)) {
        await this.lockout.registerFailure(user, manager);
        return 'invalid-code';
      }

      if (user.totpEnabledAt === null) {
        this.logger.log(`Confirming two-factor enrolment for user ${user.id}`);
      }

      await manager.update(User, user.id, {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(user.totpEnabledAt === null ? { totpEnabledAt: new Date() } : {}),
      });

      const session = await this.tokens.issueSession(
        {
          userId: user.id,
          audience: TokenAudience.Staff,
          claims: { role: user.role.name },
          context,
        },
        manager,
      );

      return { session, user };
    });

    if (result === null) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    if (result === 'invalid-code') {
      throw new UnauthorizedException('Invalid verification code');
    }

    this.logger.log(`Signed in user ${result.user.id} as ${result.user.role.name}`);

    return result;
  }

  /** Consuming the old token and issuing its replacement are one transaction. */
  async refresh(rawToken: string, context: RequestContext): Promise<StaffSession> {
    const rotated = await this.dataSource.transaction(async (manager) => {
      const { userId, familyId, tokenId } = await this.tokens.consumeRefreshToken(
        rawToken,
        TokenAudience.Staff,
        manager,
      );

      const user = await manager.findOne(User, { where: { id: userId } });

      if (!user || user.status !== UserStatus.Active) {
        // Ending the family is the outcome here, so it commits and the 401 is thrown after.
        await this.tokens.revokeFamily(familyId, manager);
        return null;
      }

      this.logger.log(`Rotating staff session for user ${userId} in family ${familyId}`);

      const session = await this.tokens.issueSession(
        {
          userId,
          audience: TokenAudience.Staff,
          claims: { role: user.role.name },
          familyId,
          replacesTokenId: tokenId,
          context,
        },
        manager,
      );

      return { session, user };
    });

    if (!rotated) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return rotated;
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      this.logger.log('Skipping staff logout: the request carried no refresh token');
      return;
    }

    try {
      const familyId = await this.dataSource.transaction(async (manager) => {
        const consumed = await this.tokens.consumeRefreshToken(
          rawToken,
          TokenAudience.Staff,
          manager,
        );

        await this.tokens.revokeFamily(consumed.familyId, manager);

        return consumed.familyId;
      });

      this.logger.log(`Signed out; revoked staff session family ${familyId}`);
    } catch (error) {
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`Failed to revoke staff session family: ${cause.message}`);
    }
  }

  /** Every session goes: a password change is how a user evicts whoever else holds one. */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const changed = await this.dataSource.transaction(async (manager) => {
      const user = await this.findByIdWithSecrets(userId, manager);

      if (!user?.passwordHash || user.role?.pinLogin || user.status !== UserStatus.Active) {
        return false;
      }

      if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
        return false;
      }

      this.logger.log(`Changing the password for user ${user.id}, revoking its staff sessions`);

      await manager.update(User, user.id, {
        passwordHash: await this.passwords.hash(newPassword),
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      await this.tokens.revokeAllForUser(user.id, TokenAudience.Staff, manager);

      return true;
    });

    if (!changed) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
  }

  findById(userId: string): Promise<User | null> {
    return this.users.findOne({ where: { id: userId } });
  }

  // FOR UPDATE on the user row only: a lock cannot span the nullable side of the role join.
  // The alias is pre-quoted because `user` is reserved in Postgres and TypeORM emits it raw.
  private findByEmailWithSecrets(email: string, mng: EntityManager): Promise<User | null> {
    return mng
      .getRepository(User)
      .createQueryBuilder('user')
      .setLock('pessimistic_write', undefined, ['"user"'])
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.role', 'role')
      .where('user.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
  }

  private findByIdWithSecrets(id: string, mng: EntityManager): Promise<User | null> {
    return mng
      .getRepository(User)
      .createQueryBuilder('user')
      .setLock('pessimistic_write', undefined, ['"user"'])
      .addSelect('user.totpSecret')
      .addSelect('user.passwordHash')
      .leftJoinAndSelect('user.role', 'role')
      .where('user.id = :id', { id })
      .getOne();
  }
}
