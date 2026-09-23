import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import type { Request } from 'express';
import { Repository } from 'typeorm';

import { User, UserStatus } from '../../user/entities/user.entity';
import type { StaffPrincipal } from '../strategies/staff-jwt.strategy';
import { AbilityFactory } from './ability.factory';
import { PERMISSION_KEY, RequiredPermission } from './require-permission.decorator';

/**
 * Runs after the JWT guard: the token proves who the caller is, this decides
 * what they may do. Permissions are re-read per request so a revoked grant
 * takes effect without waiting for the access token to expire.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly abilities: AbilityFactory,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<RequiredPermission[]>(PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required?.length) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request & { user?: StaffPrincipal }>();
    const principal = request.user;

    if (!principal?.userId) {
      throw new ForbiddenException();
    }

    const user = await this.users.findOne({ where: { id: principal.userId } });

    if (!user || user.status !== UserStatus.Active) {
      throw new ForbiddenException();
    }

    const ability = this.abilities.createForUser(user);

    if (!required.every(([action, subject]) => ability.can(action, subject))) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
