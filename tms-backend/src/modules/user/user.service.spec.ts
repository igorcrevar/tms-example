import { BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Driver } from '../driver/entities/driver.entity';
import { TokenAudience } from '../auth/entities/refresh-token.entity';
import { TokenService } from '../auth/services/token.service';
import { User, UserStatus } from './entities/user.entity';
import { UserService } from './user.service';
import { PERMISSION_KEY } from '../auth/permissions/require-permission.decorator';
import { MailService } from '../mail/mail.service';
import { adminNoticeEmail } from '../mail/templates';
import { PermissionAction, PermissionSubject } from './entities/permission.entity';
import { UserController } from './user.controller';

const CALLER = 'caller-1';
const TARGET = 'target-1';

function user(id: string, pinLogin = false): Partial<User> {
  return {
    id,
    email: `${id}@tms.local`,
    firstName: 'Test',
    lastName: 'Staff',
    status: UserStatus.Active,
    totpEnabledAt: new Date(),
    role: { pinLogin } as User['role'],
  };
}

describe('UserService', () => {
  let users: { findOne: jest.Mock; update: jest.Mock; find: jest.Mock };
  let mail: { send: jest.Mock };
  let drivers: { find: jest.Mock };
  let tokens: { revokeAllForUser: jest.Mock };
  let manager: { update: jest.Mock; softDelete: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  function buildService(rows: Array<Partial<User>>) {
    users = {
      findOne: jest.fn((options: { where: { id: string } }) =>
        Promise.resolve(rows.find((row) => row.id === options.where.id) ?? null),
      ),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      find: jest.fn().mockResolvedValue([]),
    };
    mail = { send: jest.fn().mockResolvedValue(undefined) };
    drivers = { find: jest.fn().mockResolvedValue([]) };
    tokens = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
    manager = {
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      softDelete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    dataSource = {
      transaction: jest.fn((run: (mng: EntityManager) => unknown) =>
        run(manager as unknown as EntityManager),
      ),
    };

    return new UserService(
      users as unknown as Repository<User>,
      drivers as unknown as Repository<Driver>,
      tokens as unknown as TokenService,
      dataSource as unknown as DataSource,
      mail as unknown as MailService,
    );
  }

  describe('resetTwoFactor', () => {
    it('clears the factor and revokes the staff sessions', async () => {
      const service = buildService([user(CALLER), user(TARGET)]);

      await service.resetTwoFactor(TARGET, CALLER);

      // Clearing the factor and ending the sessions it authorised are one operation.
      expect(manager.update).toHaveBeenCalledWith(User, TARGET, {
        totpSecret: null,
        totpEnabledAt: null,
      });
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith(TARGET, TokenAudience.Staff, manager);
    });

    it('refuses to clear your own factor', async () => {
      const service = buildService([user(CALLER)]);

      await expect(service.resetTwoFactor(CALLER, CALLER)).rejects.toThrow(BadRequestException);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('refuses a driver, who signs in with a PIN', async () => {
      const service = buildService([user(CALLER), user(TARGET, true)]);

      await expect(service.resetTwoFactor(TARGET, CALLER)).rejects.toThrow(BadRequestException);
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('refuses an invitee, who has never enrolled a factor', async () => {
      const service = buildService([
        user(CALLER),
        { ...user(TARGET), status: UserStatus.Invited, totpEnabledAt: null },
      ]);

      await expect(service.resetTwoFactor(TARGET, CALLER)).rejects.toThrow(BadRequestException);
      expect(manager.update).not.toHaveBeenCalled();
    });
  });

  describe('softDelete', () => {
    it('revokes both audiences inside the transaction that deletes the rows', async () => {
      const service = buildService([user(CALLER), user(TARGET)]);

      await service.softDelete(TARGET, CALLER);

      // A commit before the revocations leaves a deleted account whose tokens still work.
      expect(manager.softDelete).toHaveBeenCalledWith(User, { id: TARGET });
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith(TARGET, TokenAudience.Staff, manager);
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith(TARGET, TokenAudience.Driver, manager);
    });

    it('refuses to delete your own account', async () => {
      const service = buildService([user(CALLER)]);

      await expect(service.softDelete(CALLER, CALLER)).rejects.toThrow(BadRequestException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('refuses to delete a super admin', async () => {
      const superAdmin = {
        ...user(TARGET),
        role: { pinLogin: false, isSuperAdmin: true } as User['role'],
      };
      const service = buildService([user(CALLER), superAdmin]);

      await expect(service.softDelete(TARGET, CALLER)).rejects.toThrow(ForbiddenException);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('sendMassEmail', () => {
    const alice = { id: 'id-alice', email: 'alice@tms.local', firstName: 'Alice' } as User;
    const bob = { id: 'id-bob', email: 'bob@tms.local', firstName: 'Bob' } as User;

    it('mails every selected user with the escaped notice', async () => {
      const service = buildService([]);
      users.find.mockResolvedValue([alice, bob]);

      const result = await service.sendMassEmail(
        { userIds: ['id-alice', 'id-bob'], subject: 'Maintenance', body: '<b>x</b>' },
        CALLER,
      );

      expect(mail.send).toHaveBeenCalledTimes(2);
      expect(mail.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'alice@tms.local',
          subject: 'Maintenance',
          html: expect.stringContaining('&lt;b&gt;x&lt;/b&gt;') as string,
        }),
      );
      expect(result).toEqual({ sent: 2, failed: [] });
    });

    it('sends once to a duplicated id', async () => {
      const service = buildService([]);
      users.find.mockResolvedValue([alice]);

      const result = await service.sendMassEmail(
        { userIds: ['id-alice', 'ID-ALICE'], subject: 's', body: 'b' },
        CALLER,
      );

      expect(mail.send).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ sent: 1, failed: [] });
    });

    it('keeps sending after a failure and logs it by user id only', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const service = buildService([]);
      users.find.mockResolvedValue([alice, bob]);
      mail.send.mockRejectedValueOnce(new Error('smtp down')).mockResolvedValueOnce(undefined);

      const result = await service.sendMassEmail(
        { userIds: ['id-alice', 'id-bob'], subject: 's', body: 'b' },
        CALLER,
      );

      expect(mail.send).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ sent: 1, failed: [{ userId: 'id-alice' }] });
      expect(warn).toHaveBeenCalledWith('Mass email to user id-alice failed (unknown)');
      for (const call of warn.mock.calls) {
        expect(String(call[0])).not.toContain('@');
      }
      warn.mockRestore();
    });

    it('rejects unknown user ids before sending anything', async () => {
      const service = buildService([]);
      users.find.mockResolvedValue([alice]);

      await expect(
        service.sendMassEmail(
          { userIds: ['id-alice', 'id-missing'], subject: 's', body: 'b' },
          CALLER,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mail.send).not.toHaveBeenCalled();
    });

    it('builds an HTML part with the body escaped', () => {
      const message = adminNoticeEmail({ firstName: 'A', subject: 's', body: '<b>hi</b>' });

      expect(message.text).toContain('<b>hi</b>');
      expect(message.html).not.toContain('<b>hi</b>');
      expect(message.html).toContain('&lt;b&gt;hi&lt;/b&gt;');
    });

    it('declares the update User permission on the handler', () => {
      const handler = Object.getOwnPropertyDescriptor(UserController.prototype, 'massEmail')
        ?.value as object;
      const metadata: unknown = Reflect.getMetadata(PERMISSION_KEY, handler);

      expect(metadata).toEqual([[PermissionAction.Update, PermissionSubject.User]]);
    });
  });
});
