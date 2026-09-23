import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Repository } from 'typeorm';

import { PermissionAction, PermissionSubject } from '../../user/entities/permission.entity';
import { User, UserStatus } from '../../user/entities/user.entity';
import { AbilityFactory } from './ability.factory';
import { PermissionsGuard } from './permissions.guard';
import { RequiredPermission } from './require-permission.decorator';

function contextFor(userId?: string): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user: userId ? { userId } : undefined }) }),
  } as unknown as ExecutionContext;
}

function guardFor(options: {
  required: RequiredPermission[] | undefined;
  user: Partial<User> | null;
}): { guard: PermissionsGuard; users: { findOne: jest.Mock } } {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(options.required) };
  const users = { findOne: jest.fn().mockResolvedValue(options.user) };

  const guard = new PermissionsGuard(
    reflector as unknown as Reflector,
    new AbilityFactory(),
    users as unknown as Repository<User>,
  );

  return { guard, users };
}

const activeUserWith = (grants: Array<[PermissionAction, PermissionSubject]>): Partial<User> =>
  ({
    id: 'user-1',
    status: UserStatus.Active,
    role: { permissions: grants.map(([action, subject]) => ({ action, subject })) },
  }) as unknown as Partial<User>;

describe('PermissionsGuard', () => {
  it('allows a route that requires nothing', async () => {
    const { guard, users } = guardFor({ required: undefined, user: null });

    await expect(guard.canActivate(contextFor('user-1'))).resolves.toBe(true);
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('allows a caller holding the required permission', async () => {
    const { guard } = guardFor({
      required: [[PermissionAction.Delete, PermissionSubject.User]],
      user: activeUserWith([[PermissionAction.Manage, PermissionSubject.User]]),
    });

    await expect(guard.canActivate(contextFor('user-1'))).resolves.toBe(true);
  });

  it('refuses a caller who lacks it', async () => {
    const { guard } = guardFor({
      required: [[PermissionAction.Delete, PermissionSubject.User]],
      user: activeUserWith([[PermissionAction.Read, PermissionSubject.User]]),
    });

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses when the token names a user who no longer exists', async () => {
    const { guard } = guardFor({
      required: [[PermissionAction.Read, PermissionSubject.User]],
      user: null,
    });

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a user who is no longer active', async () => {
    const { guard } = guardFor({
      required: [[PermissionAction.Read, PermissionSubject.User]],
      user: {
        ...activeUserWith([[PermissionAction.Manage, PermissionSubject.All]]),
        status: UserStatus.Suspended,
      },
    });

    await expect(guard.canActivate(contextFor('user-1'))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('refuses a request with no authenticated principal', async () => {
    const { guard } = guardFor({
      required: [[PermissionAction.Read, PermissionSubject.User]],
      user: activeUserWith([[PermissionAction.Manage, PermissionSubject.All]]),
    });

    await expect(guard.canActivate(contextFor())).rejects.toBeInstanceOf(ForbiddenException);
  });
});
