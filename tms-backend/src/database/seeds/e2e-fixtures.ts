import { EntityManager } from 'typeorm';

import { AppConfig, Environment } from '../../config/app-config';
import { PasswordService } from '../../modules/auth/services/password.service';
import { Driver, DriverType } from '../../modules/driver/entities/driver.entity';
import { Role, RoleName } from '../../modules/user/entities/role.entity';
import { User, UserStatus } from '../../modules/user/entities/user.entity';
import dataSource from '../data-source';

/**
 * Fixtures for the browser tests. Values are fixed so the Playwright suite can
 * sign in without reading the database; they are test data, not credentials.
 */
export const E2E_STAFF_EMAIL = 'e2e-ui-admin@tms.local';
export const E2E_STAFF_PASSWORD = 'e2e-ui-password-long-enough';
export const E2E_TOTP_SECRET = 'KRSXG5CTMVRXEZLUKQ2TEMY';
export const E2E_DRIVER_CODE = 'E2E-UI-1';
export const E2E_DRIVER_PIN = '482913';
export const E2E_DRIVER_EMAIL = 'e2e-ui-driver@tms.local';
export const E2E_SUPER_ADMIN_EMAIL = 'e2e-ui-superadmin@tms.local';
export const E2E_SUPER_ADMIN_PASSWORD = 'e2e-ui-superadmin-password-long-enough';
export const E2E_SUPER_ADMIN_TOTP_SECRET = 'KN2XAZLSIFSG22LOKVEVGZLDOJSXIM';

async function resetUser(manager: EntityManager, email: string): Promise<void> {
  const existing = await manager.findOne(User, { where: { email } });

  if (!existing) {
    return;
  }

  await manager.query('DELETE FROM refresh_tokens WHERE "userId" = $1', [existing.id]);
  await manager.query('DELETE FROM drivers WHERE "userId" = $1', [existing.id]);
  await manager.query('DELETE FROM users WHERE id = $1', [existing.id]);
}

async function run(): Promise<void> {
  if (AppConfig.load(process.env).app.env === Environment.Production) {
    throw new Error('Refusing to seed browser-test fixtures in production');
  }

  await dataSource.initialize();

  try {
    await dataSource.transaction(async (manager) => {
      const passwords = new PasswordService();

      await resetUser(manager, E2E_STAFF_EMAIL);
      await resetUser(manager, E2E_DRIVER_EMAIL);
      await resetUser(manager, E2E_SUPER_ADMIN_EMAIL);

      const adminRole = await manager.findOneOrFail(Role, { where: { name: RoleName.Admin } });
      const driverRole = await manager.findOneOrFail(Role, { where: { name: RoleName.Driver } });
      const superAdminRole = await manager.findOneOrFail(Role, {
        where: { name: RoleName.SuperAdmin },
      });

      await manager.save(
        manager.create(User, {
          email: E2E_STAFF_EMAIL,
          firstName: 'Browser',
          lastName: 'Admin',
          passwordHash: await passwords.hash(E2E_STAFF_PASSWORD),
          status: UserStatus.Active,
          totpSecret: E2E_TOTP_SECRET,
          totpEnabledAt: new Date(),
          roleId: adminRole.id,
        }),
      );

      await manager.save(
        manager.create(User, {
          email: E2E_SUPER_ADMIN_EMAIL,
          firstName: 'Browser',
          lastName: 'SuperAdmin',
          passwordHash: await passwords.hash(E2E_SUPER_ADMIN_PASSWORD),
          status: UserStatus.Active,
          totpSecret: E2E_SUPER_ADMIN_TOTP_SECRET,
          totpEnabledAt: new Date(),
          roleId: superAdminRole.id,
        }),
      );

      const driverUser = await manager.save(
        manager.create(User, {
          email: E2E_DRIVER_EMAIL,
          firstName: 'Browser',
          lastName: 'Driver',
          passwordHash: null,
          status: UserStatus.Active,
          roleId: driverRole.id,
        }),
      );

      await manager.save(
        manager.create(Driver, {
          driverCode: E2E_DRIVER_CODE,
          userId: driverUser.id,
          driverType: DriverType.Truck,
          pinHash: await passwords.hash(E2E_DRIVER_PIN),
          pinUpdatedAt: new Date(),
        }),
      );
    });

    process.stdout.write('Browser-test fixtures ready\n');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`Fixture seed failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
