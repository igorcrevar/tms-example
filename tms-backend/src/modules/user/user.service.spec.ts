import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';

import { Driver } from '../driver/entities/driver.entity';
import { TokenAudience } from '../auth/entities/refresh-token.entity';
import { TokenService } from '../auth/services/token.service';
import { User, UserStatus } from './entities/user.entity';
import { UserService } from './user.service';

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
  let users: { findOne: jest.Mock; update: jest.Mock };
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
    };
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
});
