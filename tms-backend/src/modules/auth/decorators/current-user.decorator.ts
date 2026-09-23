import { ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

import type { DriverPrincipal } from '../strategies/driver-jwt.strategy';
import type { StaffPrincipal } from '../strategies/staff-jwt.strategy';

export type Principal = StaffPrincipal | DriverPrincipal;

export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<Request & { user?: Principal }>();

  return request.user;
});
