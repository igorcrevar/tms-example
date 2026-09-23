import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Driver } from '../../driver/entities/driver.entity';
import { User, UserStatus } from '../../user/entities/user.entity';
import { TokenAudience } from '../entities/refresh-token.entity';
import { LockoutService } from './lockout.service';
import { PasswordService } from './password.service';
import { IssuedSession, RequestContext, TokenService } from './token.service';

const INVALID_CREDENTIALS = 'Invalid credentials';

export interface DriverSession {
  session: IssuedSession;
  driver: Driver;
}

@Injectable()
export class DriverAuthService {
  private readonly logger = new Logger(DriverAuthService.name);

  constructor(
    @InjectRepository(Driver) private readonly drivers: Repository<Driver>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly lockout: LockoutService,
    private readonly dataSource: DataSource,
  ) {}

  async login(driverCode: string, pin: string, context: RequestContext): Promise<DriverSession> {
    // The rows are locked for the whole check so concurrent failures count one by one. A
    // throw inside would roll the failure write back, so the verdict is thrown after commit.
    const result = await this.dataSource.transaction(async (manager) => {
      const driver = await this.findByCodeWithSecrets(driverCode, manager);

      // A driver row under a password role is misconfiguration, not a PIN account.
      if (!driver?.user?.role?.pinLogin || this.lockout.isLocked(driver.user)) {
        await this.passwords.verifyDummy(pin);
        return null;
      }

      const pinMatches = await this.passwords.verify(driver.pinHash, pin);

      if (!pinMatches || driver.user.status !== UserStatus.Active) {
        await this.lockout.registerFailure(driver.user, manager);
        return null;
      }

      this.logger.log(`Signing in driver ${driver.id} (${driver.driverType})`);
      await manager.update(User, driver.userId, { failedLoginAttempts: 0, lockedUntil: null });

      const session = await this.tokens.issueSession(
        {
          userId: driver.userId,
          audience: TokenAudience.Driver,
          claims: { driverId: driver.id, driverType: driver.driverType },
          context,
        },
        manager,
      );

      return { session, driver };
    });

    if (!result) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return result;
  }

  /** Consuming the old token and issuing its replacement are one transaction. */
  async refresh(rawToken: string, context: RequestContext): Promise<DriverSession> {
    const rotated = await this.dataSource.transaction(async (manager) => {
      const { userId, familyId, tokenId } = await this.tokens.consumeRefreshToken(
        rawToken,
        TokenAudience.Driver,
        manager,
      );

      const driver = await manager.findOne(Driver, {
        where: { userId },
        relations: { user: true },
      });

      if (!driver || driver.user.status !== UserStatus.Active) {
        // Ending the family is the outcome here, so it commits and the 401 is thrown after.
        await this.tokens.revokeFamily(familyId, manager);
        return null;
      }

      this.logger.log(`Rotating driver session for driver ${driver.id} in family ${familyId}`);

      const session = await this.tokens.issueSession(
        {
          userId,
          audience: TokenAudience.Driver,
          claims: { driverId: driver.id, driverType: driver.driverType },
          familyId,
          replacesTokenId: tokenId,
          context,
        },
        manager,
      );

      return { session, driver };
    });

    if (!rotated) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }

    return rotated;
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      this.logger.log('Skipping driver logout: the request carried no refresh token');
      return;
    }

    try {
      const familyId = await this.dataSource.transaction(async (manager) => {
        const consumed = await this.tokens.consumeRefreshToken(
          rawToken,
          TokenAudience.Driver,
          manager,
        );

        await this.tokens.revokeFamily(consumed.familyId, manager);

        return consumed.familyId;
      });

      this.logger.log(`Signed out; revoked driver session family ${familyId}`);
    } catch (error) {
      // Already invalid or reused; consumeRefreshToken has done any revoking.
      const cause = error instanceof Error ? error : new Error(String(error));
      this.logger.warn(`Failed to revoke driver session family: ${cause.message}`);
    }
  }

  findByUserId(userId: string): Promise<Driver | null> {
    return this.drivers.findOne({ where: { userId }, relations: { user: true } });
  }

  // The lockout counters sit on the user row, so it is locked with the driver. An inner
  // join because FOR UPDATE cannot cover the nullable side of an outer join; the alias is
  // pre-quoted because `user` is reserved in Postgres and TypeORM emits it raw.
  private findByCodeWithSecrets(driverCode: string, mng: EntityManager): Promise<Driver | null> {
    return mng
      .getRepository(Driver)
      .createQueryBuilder('driver')
      .setLock('pessimistic_write', undefined, ['driver', '"user"'])
      .addSelect('driver.pinHash')
      .innerJoinAndSelect('driver.user', 'user')
      .leftJoinAndSelect('user.role', 'role')
      .where('driver.driverCode = :driverCode', { driverCode: driverCode.trim() })
      .getOne();
  }
}
