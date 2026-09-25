import { UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { RoleName } from '../../user/entities/role.entity';
import { User, UserStatus } from '../../user/entities/user.entity';
import { TokenAudience } from '../entities/refresh-token.entity';
import { LockoutService } from './lockout.service';
import { PasswordService } from './password.service';
import { StaffAuthService } from './staff-auth.service';
import { TokenService } from './token.service';
import { TotpService } from './totp.service';
import { configFor } from '../../../config/app-config.fixture';

const PASSWORD = 'correct horse battery staple';

function buildUsersRepository(user: Partial<User> | null) {
  const queryBuilder = {
    addSelect: jest.fn().mockReturnThis(),
    leftJoinAndSelect: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn().mockResolvedValue(user),
  };

  return {
    queryBuilder,
    createQueryBuilder: jest.fn().mockReturnValue(queryBuilder),
    findOne: jest.fn().mockResolvedValue(user),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
  };
}

describe('StaffAuthService', () => {
  const passwords = new PasswordService();
  const lockoutConfig = configFor({ AUTH_MAX_FAILED_ATTEMPTS: '3', AUTH_LOCKOUT_MS: '900000' });

  let passwordHash: string;
  let totp: {
    verify: jest.Mock;
    generateSecret: jest.Mock;
    buildUri: jest.Mock;
    buildQrDataUrl: jest.Mock;
  };
  let tokens: {
    createMfaChallenge: jest.Mock;
    expiryOf: jest.Mock;
    issueSession: jest.Mock;
    consumeRefreshToken: jest.Mock;
    revokeFamily: jest.Mock;
    revokeAllForUser: jest.Mock;
  };
  let manager: { update: jest.Mock; findOne: jest.Mock; getRepository: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  beforeAll(async () => {
    passwordHash = await passwords.hash(PASSWORD);
  });

  beforeEach(() => {
    totp = {
      verify: jest.fn().mockReturnValue(true),
      generateSecret: jest.fn().mockReturnValue('SECRET'),
      buildUri: jest.fn().mockReturnValue('otpauth://totp/TMS:a@b.c'),
      buildQrDataUrl: jest.fn().mockResolvedValue('data:image/png;base64,x'),
    };
    tokens = {
      createMfaChallenge: jest.fn().mockResolvedValue('challenge-token'),
      expiryOf: jest.fn().mockReturnValue(new Date('2026-01-01T00:05:00.000Z')),
      issueSession: jest.fn().mockResolvedValue({ accessToken: 'a', refreshToken: 'r' }),
      consumeRefreshToken: jest.fn(),
      revokeFamily: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };
  });

  function buildService(user: Partial<User> | null) {
    const users = buildUsersRepository(user);

    // Captured per service: two services built in one test must not share a manager.
    const ownManager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      findOne: jest.fn().mockResolvedValue(user),
      getRepository: jest.fn().mockReturnValue(users),
    };
    manager = ownManager;
    dataSource = {
      transaction: jest.fn((run: (mng: EntityManager) => unknown) =>
        run(ownManager as unknown as EntityManager),
      ),
    };

    const service = new StaffAuthService(
      users as unknown as Repository<User>,
      passwords,
      totp as unknown as TotpService,
      tokens as unknown as TokenService,
      new LockoutService(users as unknown as Repository<User>, lockoutConfig),
      dataSource as unknown as DataSource,
    );

    return { service, users };
  }

  function activeUser(overrides: Partial<User> = {}): Partial<User> {
    return {
      id: 'user-1',
      email: 'admin@tms.local',
      passwordHash,
      status: UserStatus.Active,
      failedLoginAttempts: 0,
      lockedUntil: null,
      totpEnabledAt: new Date('2025-01-01T00:00:00.000Z'),
      totpSecret: 'SECRET',
      role: { name: RoleName.Admin, pinLogin: false } as User['role'],
      ...overrides,
    };
  }

  describe('login', () => {
    it('returns an MFA challenge rather than a session', async () => {
      const { service } = buildService(activeUser());

      const result = await service.login('admin@tms.local', PASSWORD);

      expect(result.challengeToken).toBe('challenge-token');
      expect(result.enrolmentRequired).toBe(false);
      expect(tokens.issueSession).not.toHaveBeenCalled();
    });

    it('flags enrolment when the user has no confirmed authenticator', async () => {
      const { service } = buildService(activeUser({ totpEnabledAt: null }));

      await expect(service.login('admin@tms.local', PASSWORD)).resolves.toMatchObject({
        enrolmentRequired: true,
      });
    });

    it('rejects an unknown email with the same error as a wrong password', async () => {
      const unknown = buildService(null);
      const wrongPassword = buildService(activeUser());

      const unknownError = await unknown.service
        .login('nobody@tms.local', PASSWORD)
        .catch((e: Error) => e);
      const wrongError = await wrongPassword.service
        .login('admin@tms.local', 'not the password')
        .catch((e: Error) => e);

      expect(unknownError).toBeInstanceOf(UnauthorizedException);
      expect((unknownError as Error).message).toBe((wrongError as Error).message);
    });

    it('refuses a driver on the staff API even with correct credentials', async () => {
      const { service } = buildService(activeUser({ role: { pinLogin: true } as User['role'] }));

      await expect(service.login('driver@tms.local', PASSWORD)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('refuses a locked account without checking the password', async () => {
      const { service, users } = buildService(
        activeUser({ lockedUntil: new Date(Date.now() + 60_000) }),
      );

      await expect(service.login('admin@tms.local', PASSWORD)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(users.update).not.toHaveBeenCalled();
    });

    it('refuses a user who has not accepted their invitation', async () => {
      const { service } = buildService(activeUser({ status: UserStatus.Invited }));

      await expect(service.login('admin@tms.local', PASSWORD)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('locks the account on the configured number of failures', async () => {
      const { service, users } = buildService(activeUser({ failedLoginAttempts: 2 }));

      await expect(service.login('admin@tms.local', 'wrong')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(users.update).toHaveBeenCalledWith('user-1', {
        failedLoginAttempts: 3,
        lockedUntil: expect.any(Date) as Date,
      });
    });
  });

  describe('refresh', () => {
    it('revokes the family when the account behind the token is gone', async () => {
      tokens.consumeRefreshToken.mockResolvedValue({
        userId: 'user-1',
        familyId: 'fam-1',
        tokenId: 'tok-1',
      });
      const { service } = buildService(null);

      await expect(service.refresh('raw-token', {})).rejects.toBeInstanceOf(UnauthorizedException);

      // The revocation is the outcome, so it commits with the transaction and the 401 follows.
      expect(tokens.revokeFamily).toHaveBeenCalledWith('fam-1', manager);
      expect(tokens.issueSession).not.toHaveBeenCalled();
    });
  });

  describe('completeLogin', () => {
    it('issues a staff session and records the login', async () => {
      const { service, users } = buildService(activeUser());

      await service.completeLogin({ userId: 'user-1', enrolmentRequired: false }, '123456', {});

      // Counters and the new refresh token are one operation, so both go through `manager`.
      expect(tokens.issueSession).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-1', audience: TokenAudience.Staff }),
        manager,
      );
      expect(manager.update).toHaveBeenCalledWith(
        User,
        'user-1',
        expect.objectContaining({ failedLoginAttempts: 0, lastLoginAt: expect.any(Date) as Date }),
      );
      expect(users.update).not.toHaveBeenCalled();
    });

    it('confirms enrolment the first time a code verifies', async () => {
      const { service } = buildService(activeUser({ totpEnabledAt: null }));

      await service.completeLogin({ userId: 'user-1', enrolmentRequired: true }, '123456', {});

      expect(manager.update).toHaveBeenCalledWith(
        User,
        'user-1',
        expect.objectContaining({ totpEnabledAt: expect.any(Date) as Date }),
      );
    });

    it('counts a wrong code towards the lockout and issues nothing', async () => {
      totp.verify.mockReturnValue(false);
      const { service, users } = buildService(activeUser({ failedLoginAttempts: 2 }));

      await expect(
        service.completeLogin({ userId: 'user-1', enrolmentRequired: false }, '000000', {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(tokens.issueSession).not.toHaveBeenCalled();
      expect(users.update).toHaveBeenCalledWith('user-1', {
        failedLoginAttempts: 3,
        lockedUntil: expect.any(Date) as Date,
      });
    });
  });

  describe('changePassword', () => {
    it('stores the new hash and revokes every staff session in one transaction', async () => {
      const { service } = buildService(activeUser());

      await service.changePassword('user-1', PASSWORD, 'a brand new passphrase');

      expect(manager.update).toHaveBeenCalledWith(
        User,
        'user-1',
        expect.objectContaining({
          passwordHash: expect.any(String) as string,
          failedLoginAttempts: 0,
          lockedUntil: null,
        }),
      );
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1', TokenAudience.Staff, manager);
    });

    it('rejects a wrong current password with the login message and writes nothing', async () => {
      const { service } = buildService(activeUser());

      const error = await service
        .changePassword('user-1', 'not the password', 'a brand new passphrase')
        .catch((e: Error) => e);

      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as Error).message).toBe('Invalid credentials');
      expect(manager.update).not.toHaveBeenCalled();
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('refuses a PIN role even with the correct password', async () => {
      const { service } = buildService(activeUser({ role: { pinLogin: true } as User['role'] }));

      await expect(
        service.changePassword('user-1', PASSWORD, 'a brand new passphrase'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(manager.update).not.toHaveBeenCalled();
    });
  });
});
