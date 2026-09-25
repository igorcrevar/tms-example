import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';

import { TokenAudience } from '../auth/entities/refresh-token.entity';
import { PasswordService } from '../auth/services/password.service';
import { TokenService } from '../auth/services/token.service';
import { Role } from '../user/entities/role.entity';
import { User, UserStatus } from '../user/entities/user.entity';
import { DriverService } from './driver.service';
import { Driver } from './entities/driver.entity';
import { PinResetRequest } from './entities/pin-reset-request.entity';

const ACTOR = 'actor-1';
const DRIVER_ID = 'driver-1';
const USER_ID = 'user-1';
const CODE = 'DRV-0001';

function driver(status = UserStatus.Active): Partial<Driver> {
  return {
    id: DRIVER_ID,
    userId: USER_ID,
    driverCode: CODE,
    user: { id: USER_ID, status } as User,
  };
}

describe('DriverService', () => {
  let drivers: { findOne: jest.Mock };
  let pinResets: { existsBy: jest.Mock; insert: jest.Mock };
  let tokens: { revokeAllForUser: jest.Mock };
  let manager: { update: jest.Mock };

  function buildService(row: Partial<Driver> | null, openRequest = false) {
    drivers = { findOne: jest.fn().mockResolvedValue(row) };
    pinResets = {
      existsBy: jest.fn().mockResolvedValue(openRequest),
      insert: jest.fn().mockResolvedValue(undefined),
    };
    tokens = { revokeAllForUser: jest.fn().mockResolvedValue(undefined) };
    manager = { update: jest.fn().mockResolvedValue({ affected: 1 }) };
    const passwords = { hash: jest.fn().mockResolvedValue('$argon2id$hash') };
    const dataSource = {
      transaction: jest.fn((run: (mng: EntityManager) => unknown) =>
        run(manager as unknown as EntityManager),
      ),
    };

    return new DriverService(
      drivers as unknown as Repository<Driver>,
      pinResets as unknown as Repository<PinResetRequest>,
      {} as Repository<User>,
      {} as Repository<Role>,
      passwords as unknown as PasswordService,
      tokens as unknown as TokenService,
      dataSource as unknown as DataSource,
    );
  }

  describe('requestPinReset', () => {
    it('records a request for an active driver', async () => {
      const service = buildService(driver());

      await service.requestPinReset(` ${CODE} `);

      expect(drivers.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { driverCode: CODE } }),
      );
      expect(pinResets.insert).toHaveBeenCalledWith({ driverId: DRIVER_ID });
    });

    it('does nothing for an unknown code', async () => {
      const service = buildService(null);

      await service.requestPinReset('NOPE-1');

      expect(pinResets.insert).not.toHaveBeenCalled();
    });

    it('does nothing for a suspended driver', async () => {
      const service = buildService(driver(UserStatus.Suspended));

      await service.requestPinReset(CODE);

      expect(pinResets.insert).not.toHaveBeenCalled();
    });

    it('does not open a second request while one is open', async () => {
      const service = buildService(driver(), true);

      await service.requestPinReset(CODE);

      expect(pinResets.existsBy).toHaveBeenCalledWith({
        driverId: DRIVER_ID,
        resolvedAt: IsNull(),
      });
      expect(pinResets.insert).not.toHaveBeenCalled();
    });
  });

  describe('setPin', () => {
    it('resolves the open request in the transaction that changes the PIN', async () => {
      const service = buildService(driver());

      await service.setPin(DRIVER_ID, '482913', ACTOR);

      expect(manager.update).toHaveBeenCalledWith(
        PinResetRequest,
        { driverId: DRIVER_ID, resolvedAt: IsNull() },
        { resolvedAt: expect.any(Date) as Date, resolvedById: ACTOR },
      );
      expect(tokens.revokeAllForUser).toHaveBeenCalledWith(USER_ID, TokenAudience.Driver, manager);
    });
  });
});
