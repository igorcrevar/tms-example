import { UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Driver, DriverType } from '../../driver/entities/driver.entity';
import { User, UserStatus } from '../../user/entities/user.entity';
import { TokenAudience } from '../entities/refresh-token.entity';
import { DriverAuthService } from './driver-auth.service';
import { LockoutService } from './lockout.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { configFor } from '../../../config/app-config.fixture';

const PIN = '482913';

function buildDriversRepository(driver: Partial<Driver> | null) {
  const queryBuilder = {
    addSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    innerJoinAndSelect: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(driver),
  };

  return {
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    findOne: jest.fn().mockResolvedValue(driver),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

describe('DriverAuthService', () => {
  const passwords = new PasswordService();
  const lockoutConfig = configFor({ AUTH_MAX_FAILED_ATTEMPTS: '3', AUTH_LOCKOUT_MS: '900000' });

  let pinHash: string;
  let tokens: { issueSession: jest.Mock; revokeFamily: jest.Mock; consumeRefreshToken: jest.Mock };
  let manager: { update: jest.Mock; findOne: jest.Mock; getRepository: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeAll(async () => {
    pinHash = await passwords.hash(PIN);
  });

  beforeEach(() => {
    tokens = {
      issueSession: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
      consumeRefreshToken: jest.fn(),
    };
  });

  function buildService(driver: Partial<Driver> | null) {
    const drivers = buildDriversRepository(driver);
    const users = { update: jest.fn().mockResolvedValue({ affected: 1 }) };

    // Captured per service: two services built in one test must not share a manager.
    const ownManager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue(driver),
      getRepository: jest.fn((entity: unknown) => (entity === Driver ? drivers : users)),
    };
    manager = ownManager;
    dataSource = {
      transaction: jest.fn((run: (mng: EntityManager) => unknown) =>
        run(ownManager as unknown as EntityManager),
      ),
    };

    const service = new DriverAuthService(
      drivers as unknown as Repository<Driver>,
      users as unknown as Repository<User>,
      passwords,
      tokens as unknown as TokenService,
      new LockoutService(users as unknown as Repository<User>, lockoutConfig),
      dataSource as unknown as DataSource,
    );

    return { service, drivers, users };
  }

  function activeDriver(overrides: Partial<Driver> = {}): Partial<Driver> {
    return {
      id: 'driver-1',
      userId: 'user-9',
      driverCode: 'DRV-0001',
      driverType: DriverType.Truck,
      pinHash,
      user: activeUser(),
      ...overrides,
    };
  }

  function activeUser(overrides: Partial<User> = {}): Driver['user'] {
    return {
      id: 'user-9',
      status: UserStatus.Active,
      role: { pinLogin: true },
      failedLoginAttempts: 0,
      lockedUntil: null,
      ...overrides,
    } as Driver['user'];
  }

  it('issues a driver-audience session and never a staff one', async () => {
    const { service } = buildService(activeDriver());

    await service.login('DRV-0001', PIN, {});

    expect(tokens.issueSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-9',
        audience: TokenAudience.Driver,
        claims: { driverId: 'driver-1', driverType: DriverType.Truck },
      }),
      manager,
    );
  });

  it('rejects an unknown driver code and a wrong PIN identically', async () => {
    const unknown = await buildService(null)
      .service.login('DRV-9999', PIN, {})
      .catch((e: Error) => e);
    const wrongPin = await buildService(activeDriver())
      .service.login('DRV-0001', '000000', {})
      .catch((e: Error) => e);

    expect(unknown).toBeInstanceOf(UnauthorizedException);
    expect((unknown as Error).message).toBe((wrongPin as Error).message);
  });

  it('locks the user after the configured failures', async () => {
    const { service, users } = buildService(
      activeDriver({ user: activeUser({ failedLoginAttempts: 2 }) }),
    );

    await expect(service.login('DRV-0001', '000000', {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(users.update).toHaveBeenCalledWith('user-9', {
      failedLoginAttempts: 3,
      lockedUntil: expect.any(Date) as Date,
    });
  });

  it('refuses a locked user without checking the PIN', async () => {
    const { service, users } = buildService(
      activeDriver({ user: activeUser({ lockedUntil: new Date(Date.now() + 60_000) }) }),
    );

    await expect(service.login('DRV-0001', PIN, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('refuses a driver whose user record is not active', async () => {
    const { service } = buildService(
      activeDriver({ user: activeUser({ status: UserStatus.Suspended }) }),
    );

    await expect(service.login('DRV-0001', PIN, {})).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a driver row whose role does not sign in with a PIN', async () => {
    const { service, users } = buildService(
      activeDriver({ user: activeUser({ role: { pinLogin: false } as User['role'] }) }),
    );

    await expect(service.login('DRV-0001', PIN, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('refuses a driver whose user row is soft-deleted with the same 401', async () => {
    // The join filters deleted users out, so the driver row arrives without one.
    const { service, users } = buildService(activeDriver({ user: undefined }));

    await expect(service.login('DRV-0001', PIN, {})).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.update).not.toHaveBeenCalled();
  });

  it('revokes the family when refreshing a session whose driver is gone', async () => {
    tokens.consumeRefreshToken.mockResolvedValue({
      userId: 'user-9',
      familyId: 'fam-1',
      tokenId: 'tok-1',
    });
    const { service } = buildService(null);

    await expect(service.refresh('raw-token', {})).rejects.toBeInstanceOf(UnauthorizedException);

    // The revocation is the outcome, so it commits with the transaction and the 401 follows.
    expect(tokens.revokeFamily).toHaveBeenCalledWith('fam-1', manager);
  });
});
