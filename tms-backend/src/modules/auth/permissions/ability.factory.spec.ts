import { PermissionAction, PermissionSubject } from '../../user/entities/permission.entity';
import { RoleName } from '../../user/entities/role.entity';
import type { User } from '../../user/entities/user.entity';
import { AbilityFactory } from './ability.factory';

function userWith(grants: Array<[PermissionAction, PermissionSubject]>): Pick<User, 'role'> {
  return {
    role: {
      name: RoleName.Admin,
      permissions: grants.map(([action, subject]) => ({ action, subject })),
    },
  } as unknown as Pick<User, 'role'>;
}

describe('AbilityFactory', () => {
  const factory = new AbilityFactory();

  it('grants exactly what the role lists', () => {
    const ability = factory.createForUser(
      userWith([[PermissionAction.Read, PermissionSubject.User]]),
    );

    expect(ability.can(PermissionAction.Read, PermissionSubject.User)).toBe(true);
    expect(ability.can(PermissionAction.Delete, PermissionSubject.User)).toBe(false);
    expect(ability.can(PermissionAction.Read, PermissionSubject.Driver)).toBe(false);
  });

  it('treats manage as covering every action on that subject', () => {
    const ability = factory.createForUser(
      userWith([[PermissionAction.Manage, PermissionSubject.Driver]]),
    );

    expect(ability.can(PermissionAction.Create, PermissionSubject.Driver)).toBe(true);
    expect(ability.can(PermissionAction.Update, PermissionSubject.Driver)).toBe(true);
    expect(ability.can(PermissionAction.Delete, PermissionSubject.Driver)).toBe(true);
    expect(ability.can(PermissionAction.Delete, PermissionSubject.User)).toBe(false);
  });

  it('treats manage on all as the super-admin wildcard', () => {
    const ability = factory.createForUser(
      userWith([[PermissionAction.Manage, PermissionSubject.All]]),
    );

    expect(ability.can(PermissionAction.Delete, PermissionSubject.User)).toBe(true);
    expect(ability.can(PermissionAction.Create, PermissionSubject.Vehicle)).toBe(true);
  });

  it('grants nothing to a role with no permissions', () => {
    const ability = factory.createForUser(userWith([]));

    expect(ability.can(PermissionAction.Read, PermissionSubject.User)).toBe(false);
  });
});
