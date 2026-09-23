import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { AuthCookie } from '../auth.constants';
import { CurrentUser } from '../decorators/current-user.decorator';
import { DriverLoginDto } from '../dto';
import { TokenAudience } from '../entities/refresh-token.entity';
import { CsrfGuard } from '../guards/csrf.guard';
import { DriverJwtGuard } from '../guards/driver-jwt.guard';
import { requestContextOf } from '../request-context';
import { CookieService } from '../services/cookie.service';
import { DriverAuthService } from '../services/driver-auth.service';
import type { DriverPrincipal } from '../strategies/driver-jwt.strategy';

// A six-digit PIN is a small keyspace, so this limit is deliberately low.
const PIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('driver-auth')
@Controller('driver/auth')
export class DriverAuthController {
  constructor(
    private readonly auth: DriverAuthService,
    private readonly cookies: CookieService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(PIN_THROTTLE)
  async login(
    @Body() dto: DriverLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { session, driver } = await this.auth.login(
      dto.driverCode,
      dto.pin,
      requestContextOf(req),
    );

    const csrfToken = this.cookies.setSession(res, TokenAudience.Driver, session);

    return { csrfToken, driver: toDriverProfile(driver) };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle(PIN_THROTTLE)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = readCookie(req, AuthCookie.DriverRefresh);

    if (!rawToken) {
      throw new UnauthorizedException('Invalid session');
    }

    const { session, driver } = await this.auth.refresh(rawToken, requestContextOf(req));
    const csrfToken = this.cookies.setSession(res, TokenAudience.Driver, session);

    return { csrfToken, driver: toDriverProfile(driver) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CsrfGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readCookie(req, AuthCookie.DriverRefresh));
    this.cookies.clearSession(res, TokenAudience.Driver);
  }

  @Get('me')
  @UseGuards(DriverJwtGuard)
  async me(@CurrentUser() principal: DriverPrincipal) {
    const driver = await this.auth.findByUserId(principal.userId);

    if (!driver) {
      throw new NotFoundException();
    }

    return toDriverProfile(driver);
  }
}

function readCookie(req: Request, name: string): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[name];
}

function toDriverProfile(driver: {
  id: string;
  driverCode: string;
  driverType: string;
  user?: { firstName: string; lastName: string };
}) {
  return {
    id: driver.id,
    driverCode: driver.driverCode,
    driverType: driver.driverType,
    firstName: driver.user?.firstName ?? null,
    lastName: driver.user?.lastName ?? null,
  };
}
