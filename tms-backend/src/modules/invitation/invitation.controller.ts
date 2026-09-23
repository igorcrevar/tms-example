import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { CsrfGuard } from '../auth/guards/csrf.guard';
import { StaffJwtGuard } from '../auth/guards/staff-jwt.guard';
import { PermissionsGuard } from '../auth/permissions/permissions.guard';
import { RequirePermission } from '../auth/permissions/require-permission.decorator';
import type { StaffPrincipal } from '../auth/strategies/staff-jwt.strategy';
import { AcceptInvitationDto, InvitationTokenDto, InviteUserDto } from '../user/dto';
import { PermissionAction, PermissionSubject } from '../user/entities/permission.entity';
import { UserSummary } from '../user/user.mapper';
import { InvitationPreview, InvitationService } from './invitation.service';

// Unauthenticated endpoints that take a token: worth guessing at, so limited.
const TOKEN_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('invitations')
@Controller('staff/invitations')
export class InvitationController {
  private readonly logger = new Logger(InvitationController.name);

  constructor(private readonly invitations: InvitationService) {}

  @Post()
  @UseGuards(StaffJwtGuard, CsrfGuard, PermissionsGuard)
  @RequirePermission(PermissionAction.Create, PermissionSubject.User)
  invite(
    @Body() dto: InviteUserDto,
    @CurrentUser() principal: StaffPrincipal,
  ): Promise<UserSummary> {
    this.logger.log(`Inviting a ${dto.role} at the request of ${principal.userId}`);

    return this.invitations.invite(dto, principal.userId);
  }

  @Post(':userId/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(StaffJwtGuard, CsrfGuard, PermissionsGuard)
  @RequirePermission(PermissionAction.Create, PermissionSubject.User)
  resend(
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() principal: StaffPrincipal,
  ): Promise<void> {
    this.logger.log(
      `Resending the invitation for user ${userId} at the request of ${principal.userId}`,
    );

    return this.invitations.resend(userId, principal.userId);
  }

  /** Public: the accept page needs to show who the invitation is for. */
  @Get('preview')
  @Throttle(TOKEN_THROTTLE)
  preview(@Query() query: InvitationTokenDto): Promise<InvitationPreview> {
    return this.invitations.preview(query.token);
  }

  @Post('accept')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(TOKEN_THROTTLE)
  accept(@Body() dto: AcceptInvitationDto): Promise<void> {
    this.logger.log('Accepting an invitation');

    return this.invitations.accept(dto.token, dto.password);
  }
}
