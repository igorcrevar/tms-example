import { SetMetadata } from '@nestjs/common';

import { PermissionAction, PermissionSubject } from '../../user/entities/permission.entity';

export const PERMISSION_KEY = 'tms:required-permission';

export type RequiredPermission = [PermissionAction, PermissionSubject];

export const RequirePermission = (action: PermissionAction, subject: PermissionSubject) =>
  SetMetadata<string, RequiredPermission[]>(PERMISSION_KEY, [[action, subject]]);
