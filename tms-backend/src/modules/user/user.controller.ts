import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { StaffJwtGuard } from '../auth/guards/staff-jwt.guard';
import { PermissionsGuard } from '../auth/permissions/permissions.guard';
import { RequirePermission } from '../auth/permissions/require-permission.decorator';
import type { StaffPrincipal } from '../auth/strategies/staff-jwt.strategy';
import { ListUsersQueryDto, MassEmailDto } from './dto';
import { PermissionAction, PermissionSubject } from './entities/permission.entity';
import { MassEmailResult, PagedUsers, UserService } from './user.service';

// Each request can fan out to 100 emails, so volume is worth limiting.
const MASS_EMAIL_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('users')
@Controller('staff/users')
@UseGuards(StaffJwtGuard, CsrfGuard, PermissionsGuard)
export class UserController {
  private readonly logger = new Logger(UserController.name);

  constructor(private readonly users: UserService) {}

  @Get()
  @RequirePermission(PermissionAction.Read, PermissionSubject.User)
  list(
    @Query() query: ListUsersQueryDto,
    @CurrentUser() principal: StaffPrincipal,
  ): Promise<PagedUsers> {
    return this.users.list(query, principal.userId);
  }

  @Post('mass-email')
  @HttpCode(HttpStatus.OK)
  @Throttle(MASS_EMAIL_THROTTLE)
  @RequirePermission(PermissionAction.Update, PermissionSubject.User)
  massEmail(
    @Body() dto: MassEmailDto,
    @CurrentUser() principal: StaffPrincipal,
  ): Promise<MassEmailResult> {
    return this.users.sendMassEmail(dto, principal.userId);
  }

  @Delete(':id/two-factor')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionAction.Update, PermissionSubject.User)
  resetTwoFactor(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: StaffPrincipal,
  ): Promise<void> {
    this.logger.log(`Resetting two-factor for user ${id} at the request of ${principal.userId}`);

    return this.users.resetTwoFactor(id, principal.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(PermissionAction.Delete, PermissionSubject.User)
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() principal: StaffPrincipal,
  ): Promise<void> {
    this.logger.log(`Deleting user ${id} at the request of ${principal.userId}`);

    return this.users.softDelete(id, principal.userId);
  }
}
