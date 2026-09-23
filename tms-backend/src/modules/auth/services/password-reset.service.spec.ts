import { Logger, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { configFor } from '../../../config/app-config.fixture';
import { MailService } from '../../mail/mail.service';
import { User, UserStatus } from '../../user/entities/user.entity';
import { AuthToken, AuthTokenPurpose } from '../entities/auth-token.entity';
import { TokenAudience } from '../entities/refresh-token.entity';
import { PasswordResetService } from './password-reset.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const EMAIL = 'staff@tms.local';

function activeStaff(overrides: Partial<User> = {}): Partial<User> {
  return {
    id: 'user-1',
    email: EMAIL,
    firstName: 'Sam',
    status: UserStatus.Active,
    totpEnabledAt: new Date(),
    role: { pinLogin: false } as User['role'],
    ...overrides,
  };
}

function storedToken(overrides: Partial<AuthToken> = {}): Partial<AuthToken> {
  return {
    id: 'token-1',
    userId: 'user-1',
    purpose: AuthTokenPurpose.PasswordReset,
    expiresAt: new Date(Date.now() + 3_600_000),
    usedAt: null,
    user: activeStaff() as User,
    ...overrides,
  };
}

/** Lets a detached `.catch` handler run before the assertion reads it. */
const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('PasswordResetService', () => {
  const config = configFor({
    PASSWORD_RESET_TTL: '1h',
    PASSWORD_RESET_URL: 'http://localhost:5173/admin/reset-password',
  });

  let authTokens: { save: jest.Mock; create: jest.Mock; findOne: jest.Mock };
  let users: { findOne: jest.Mock };
  let mail: { send: jest.Mock };
  let tokens: { revokeAllForUser: jest.Mock };
  let claim: {
    update: jest.Mock;
    set: jest.Mock;
    where: jest.Mock;
    returning: jest.Mock;
    execute: jest.Mock;
  };
  let manager: { findOne: jest.Mock; createQueryBuilder: jest.Mock; update: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  function buildService(params: {
    user?: Partial<User> | null;
    token?: Partial<AuthToken> | null;
  }) {
    authTokens = {
      create: jest.fn((row: Partial<AuthToken>) => row),
      save: jest.fn().mockResolvedValue(storedToken()),
      findOne: jest.fn().mockResolvedValue(params.token ?? null),
    };
    users = { findOne: jest.fn().mockResolvedValue(params.user ?? null) };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    tokens = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
    claim = {
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ id: 'token-1' }] }),
    };
    manager = {
      findOne: jest.fn().mockResolvedValue(params.token ?? null),
      createQueryBuilder: jest.fn(() => claim),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      transaction: jest.fn((run: (mng: EntityManager) => unknown) =>
        run(manager as unknown as EntityManager),
      ),
    };

    return new PasswordResetService(
      authTokens as unknown as Repository<AuthToken>,
      users as unknown as Repository<User>,
      new PasswordService(),
      tokens as unknown as TokenService,
      mail as unknown as MailService,
      config,
      dataSource as unknown as DataSource,
    );
  }

  describe('request', () => {
    it('stores only a hash of the token and mails the link', async () => {
      const service = buildService({ user: activeStaff() });

      await service.request(EMAIL);

      const [[saved]] = authTokens.create.mock.calls as Array<[AuthToken]>;
      expect(saved.tokenHash).toHaveLength(64);
      expect(saved.purpose).toBe(AuthTokenPurpose.PasswordReset);

      const [[sent]] = mail.send.mock.calls as Array<[{ text: string }]>;
      const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(sent.text);
      expect(match).not.toBeNull();

      // The emailed token must not be what the row holds.
      expect(saved.tokenHash).not.toBe(match![1]);
    });

    it('sends nothing for an address with no account', async () => {
      const service = buildService({ user: null });

      await expect(service.request('nobody@tms.local')).resolves.toBeUndefined();
      expect(mail.send).not.toHaveBeenCalled();
      expect(authTokens.save).not.toHaveBeenCalled();
    });

    it('sends nothing for an account that is not active', async () => {
      const service = buildService({ user: activeStaff({ status: UserStatus.Invited }) });

      await service.request(EMAIL);

      expect(mail.send).not.toHaveBeenCalled();
    });

    it('sends nothing for a driver, who has no password to reset', async () => {
      const service = buildService({
        user: activeStaff({ role: { pinLogin: true } as User['role'] }),
      });

      await service.request(EMAIL);

      expect(mail.send).not.toHaveBeenCalled();
    });

    it('sends nothing for an account with no second factor', async () => {
      const service = buildService({ user: activeStaff({ totpEnabledAt: null }) });

      await expect(service.request(EMAIL)).resolves.toBeUndefined();

      // The link would otherwise be the whole authentication for that account.
      expect(mail.send).not.toHaveBeenCalled();
      expect(authTokens.save).not.toHaveBeenCalled();
    });

    it('resolves when the mail transport fails, and logs why', async () => {
      const service = buildService({ user: activeStaff() });
      const logged = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      mail.send.mockRejectedValue(new Error('smtp is down'));

      await expect(service.request(EMAIL)).resolves.toBeUndefined();
      await tick();

      // Swallowing the cause would leave an SMTP outage with nothing to diagnose it by.
      expect(logged).toHaveBeenCalledWith(
        expect.stringContaining('smtp is down'),
        expect.any(String),
      );

      logged.mockRestore();
    });
  });

  describe('reset', () => {
    it('sets the password, clears the lockout and revokes every staff session', async () => {
      const service = buildService({ token: storedToken() });

      await service.reset('raw-token', 'a brand new long password');

      const [, , changes] = manager.update.mock.calls[0] as [unknown, unknown, Partial<User>];
      expect(changes.passwordHash).toMatch(/^\$argon2/);
      expect(changes.failedLoginAttempts).toBe(0);
      expect(changes.lockedUntil).toBeNull();

      // The revocation joins the same transaction as the new hash.
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith('user-1', TokenAudience.Staff, manager);
    });

    it('claims this link and supersedes its siblings in one conditional statement', async () => {
      const service = buildService({ token: storedToken() });

      await service.reset('raw-token', 'a brand new long password');

      const [where, parameters] = claim.where.mock.calls[0] as [string, Record<string, unknown>];

      // Without `usedAt IS NULL` the claim stops being single-use.
      expect(where).toContain('"usedAt" IS NULL');
      expect(parameters).toEqual({
        userId: 'user-1',
        purpose: AuthTokenPurpose.PasswordReset,
      });
      expect(claim.set).toHaveBeenCalledWith({ usedAt: expect.any(Date) as Date });
    });

    it('reads the token inside the transaction that spends it', async () => {
      const service = buildService({ token: storedToken() });

      await service.reset('raw-token', 'a brand new long password');

      const [[entity, options]] = manager.findOne.mock.calls as Array<
        [unknown, { where: unknown }]
      >;

      expect(entity).toBe(AuthToken);
      expect(options).toMatchObject({ where: { purpose: AuthTokenPurpose.PasswordReset } });
      expect(authTokens.findOne).not.toHaveBeenCalled();
    });

    it('refuses a token that has already been used', async () => {
      const service = buildService({ token: storedToken({ usedAt: new Date() }) });

      await expect(service.reset('raw-token', 'a brand new long password')).rejects.toThrow(
        NotFoundException,
      );
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('refuses a token claimed concurrently by a second request', async () => {
      const service = buildService({ token: storedToken() });
      // A sibling link was swept up, but this one was already spent and did not come back.
      claim.execute.mockResolvedValue({ raw: [{ id: 'token-2' }] });

      await expect(service.reset('raw-token', 'a brand new long password')).rejects.toThrow(
        NotFoundException,
      );

      expect(manager.update).not.toHaveBeenCalled();
      expect(tokens.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('refuses an expired token', async () => {
      const service = buildService({
        token: storedToken({ expiresAt: new Date(Date.now() - 1000) }),
      });

      await expect(service.reset('raw-token', 'a brand new long password')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('does not hash the password before the token has been validated', async () => {
      const hash = jest.spyOn(PasswordService.prototype, 'hash');
      const service = buildService({ token: null });

      await expect(service.reset('raw-token', 'a brand new long password')).rejects.toThrow(
        NotFoundException,
      );
      expect(hash).not.toHaveBeenCalled();
      hash.mockRestore();
    });

    it('refuses an unknown token', async () => {
      const service = buildService({ token: null });

      await expect(service.reset('raw-token', 'a brand new long password')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a token whose account is no longer active', async () => {
      const service = buildService({
        token: storedToken({ user: activeStaff({ status: UserStatus.Suspended }) as User }),
      });

      await expect(service.reset('raw-token', 'a brand new long password')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a token whose account is a driver', async () => {
      const service = buildService({
        token: storedToken({
          user: activeStaff({ role: { pinLogin: true } as User['role'] }) as User,
        }),
      });

      await expect(service.reset('raw-token', 'a brand new long password')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a token whose account has no second factor', async () => {
      const service = buildService({
        token: storedToken({ user: activeStaff({ totpEnabledAt: null }) as User }),
      });

      await expect(service.reset('raw-token', 'a brand new long password')).rejects.toThrow(
        NotFoundException,
      );
      expect(claim.execute).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });
  });
});
