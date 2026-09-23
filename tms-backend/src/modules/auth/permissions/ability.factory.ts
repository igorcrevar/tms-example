import { Injectable } from '@nestjs/common';
import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import type { MongoAbility } from '@casl/ability';

import { PermissionAction, PermissionSubject } from '../../user/entities/permission.entity';
import type { User } from '../../user/entities/user.entity';

export type AppAbility = MongoAbility<[PermissionAction, PermissionSubject]>;

/**
 * Abilities come from the role's permission rows, never from the role name.
 * Business logic asks what a caller may do, not who they are.
 */
@Injectable()
export class AbilityFactory {
  createForUser(user: Pick<User, 'role'>): AppAbility {
    const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);

    for (const permission of user.role?.permissions ?? []) {
      can(permission.action, permission.subject);
    }

    return build();
  }
}

/** `manage` on `all` is CASL's wildcard, which is how SUPER_ADMIN is granted. */
export function canDo(
  ability: AppAbility,
  action: PermissionAction,
  subject: PermissionSubject,
): boolean {
  return ability.can(action, subject);
}
