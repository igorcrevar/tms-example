import { EntityManager } from 'typeorm';

import { AppConfig } from '../../config/app-config';
import {
  Permission,
  PermissionAction,
  PermissionSubject,
} from '../../modules/user/entities/permission.entity';
import { Role, RoleName } from '../../modules/user/entities/role.entity';
import { User, UserStatus } from '../../modules/user/entities/user.entity';
import { PasswordService } from '../../modules/auth/services/password.service';
import dataSource from '../data-source';
import { MIN_PASSWORD_LENGTH } from '../../modules/auth/auth.constants';

const { superAdmin } = AppConfig.load(process.env);

const PLACEHOLDER_PASSWORDS = new Set([
  'change-me',
  'changeme',
  'password',
  'admin',
  'superadmin',
  'secret',
]);

type RoleGrants = Record<RoleName, Array<[PermissionAction, PermissionSubject]>>;

const ROLE_GRANTS: RoleGrants = {
  [RoleName.SuperAdmin]: [[PermissionAction.Manage, PermissionSubject.All]],
  [RoleName.Admin]: [
    [PermissionAction.Manage, PermissionSubject.User],
    [PermissionAction.Manage, PermissionSubject.Driver],
    [PermissionAction.Manage, PermissionSubject.Shipment],
    [PermissionAction.Manage, PermissionSubject.Vehicle],
    [PermissionAction.Read, PermissionSubject.Role],
  ],
  [RoleName.Driver]: [[PermissionAction.Read, PermissionSubject.Shipment]],
};

function readSuperAdminCredentials(): { email: string; password: string } {
  const email = superAdmin.email.trim().toLowerCase();
  const password = superAdmin.password;

  if (!email || !password) {
    throw new Error('SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must be set before seeding');
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`SUPER_ADMIN_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  if (PLACEHOLDER_PASSWORDS.has(password.toLowerCase())) {
    throw new Error('SUPER_ADMIN_PASSWORD is a placeholder value; choose a real secret');
  }

  return { email, password };
}

async function upsertPermissions(manager: EntityManager): Promise<Map<string, Permission>> {
  const wanted = new Map<string, [PermissionAction, PermissionSubject]>();

  for (const grants of Object.values(ROLE_GRANTS)) {
    for (const [action, subject] of grants) {
      wanted.set(`${action}:${subject}`, [action, subject]);
    }
  }

  const result = new Map<string, Permission>();

  for (const [key, [action, subject]] of wanted) {
    const existing = await manager.findOne(Permission, { where: { action, subject } });
    result.set(
      key,
      existing ?? (await manager.save(manager.create(Permission, { action, subject }))),
    );
  }

  return result;
}

async function upsertRoles(
  manager: EntityManager,
  permissions: Map<string, Permission>,
): Promise<Map<RoleName, Role>> {
  const result = new Map<RoleName, Role>();

  for (const [name, grants] of Object.entries(ROLE_GRANTS) as Array<
    [RoleName, Array<[PermissionAction, PermissionSubject]>]
  >) {
    const granted = grants.map(([action, subject]) => permissions.get(`${action}:${subject}`)!);
    const existing = await manager.findOne(Role, { where: { name } });

    const role = existing ?? manager.create(Role, { name });
    role.permissions = granted;
    role.pinLogin = name === RoleName.Driver;
    role.isSuperAdmin = name === RoleName.SuperAdmin;

    result.set(name, await manager.save(role));
  }

  return result;
}

async function upsertSuperAdmin(
  manager: EntityManager,
  roles: Map<RoleName, Role>,
  email: string,
  password: string,
): Promise<'created' | 'exists'> {
  const existing = await manager.findOne(User, { where: { email } });

  if (existing) {
    return 'exists';
  }

  const passwords = new PasswordService();

  await manager.save(
    manager.create(User, {
      email,
      firstName: superAdmin.firstName,
      lastName: superAdmin.lastName,
      passwordHash: await passwords.hash(password),
      status: UserStatus.Active,
      roleId: roles.get(RoleName.SuperAdmin)!.id,
    }),
  );

  return 'created';
}

async function run(): Promise<void> {
  const { email, password } = readSuperAdminCredentials();

  await dataSource.initialize();

  try {
    const outcome = await dataSource.transaction(async (manager) => {
      const permissions = await upsertPermissions(manager);
      const roles = await upsertRoles(manager, permissions);

      return upsertSuperAdmin(manager, roles, email, password);
    });

    // Log the address only; the password never reaches stdout or a log file.
    process.stdout.write(
      outcome === 'created'
        ? `Seeded roles, permissions and super admin ${email}\n`
        : `Seeded roles and permissions; super admin ${email} already exists\n`,
    );
    process.stdout.write('Two-factor enrolment happens at first login.\n');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error: unknown) => {
  process.stderr.write(`Seed failed: ${(error as Error).message}\n`);
  process.exitCode = 1;
});
