import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { PermissionAction, PermissionSubject } from '../user/entities/permission.entity';
import { UserSummary } from '../user/user.mapper';
import { CreateDriverDto, ForgotPinDto, SetDriverPinDto } from './dto';
import { DriverService, PinResetRequestSummary } from './driver.service';

// Same ceiling as the PIN login: the response is uniform, so only volume is worth limiting.
const PIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('drivers')
@Controller()
export class DriverController {
  private readonly logger = new Logger(DriverController.name);

  constructor(private readonly drivers: DriverService) {}

  @Post('staff/drivers')
  @UseGuards(StaffJwtGuard, CsrfGuard, PermissionsGuard)
  @RequirePermission(PermissionAction.Create, PermissionSubject.Driver)
  create(
    @Body() dto: CreateDriverDto,
    @CurrentUser() principal: StaffPrincipal,
  ): Promise<UserSummary> {
    this.logger.log(`Adding driver ${dto.driverCode} at the request of ${principal.userId}`);

    return this.drivers.create(dto, principal.userId);
  }

  @Get('staff/drivers/pin-reset-requests')
  @UseGuards(StaffJwtGuard, CsrfGuard, PermissionsGuard)
  @RequirePermission(PermissionAction.Read, PermissionSubject.Driver)
  listPinResetRequests(): Promise<PinResetRequestSummary[]> {
    return this.drivers.listOpenPinResetRequests();
  }

  @Put('staff/drivers/:id/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(StaffJwtGuard, CsrfGuard, PermissionsGuard)
  @RequirePermission(PermissionAction.Update, PermissionSubject.Driver)
  setPin(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetDriverPinDto,
    @CurrentUser() principal: StaffPrincipal,
  ): Promise<void> {
    this.logger.log(`Setting a new PIN for driver ${id} at the request of ${principal.userId}`);

    return this.drivers.setPin(id, dto.pin, principal.userId);
  }

  /** Unauthenticated and always 204, so the response cannot reveal which codes exist. */
  @Post('driver/auth/forgot-pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(PIN_THROTTLE)
  forgotPin(@Body() dto: ForgotPinDto): Promise<void> {
    return this.drivers.requestPinReset(dto.driverCode);
  }
}
