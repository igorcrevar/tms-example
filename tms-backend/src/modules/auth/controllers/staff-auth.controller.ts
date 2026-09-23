import {
  Body,
  Controller,
  ForbiddenException,
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
import { ForgotPasswordDto, ResetPasswordDto, StaffLoginDto, TotpCodeDto } from '../dto';
import { TokenAudience } from '../entities/refresh-token.entity';
import { CsrfGuard } from '../guards/csrf.guard';
import { StaffJwtGuard } from '../guards/staff-jwt.guard';
import { requestContextOf } from '../request-context';
import { CookieService } from '../services/cookie.service';
import { PasswordResetService } from '../services/password-reset.service';
import { StaffAuthService } from '../services/staff-auth.service';
import { MfaChallenge, TokenService } from '../services/token.service';
import type { StaffPrincipal } from '../strategies/staff-jwt.strategy';

/** Tighter than the global limit: these are the endpoints worth guessing at. */
const AUTH_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('staff-auth')
@Controller('staff/auth')
export class StaffAuthController {
  constructor(
    private readonly auth: StaffAuthService,
    private readonly cookies: CookieService,
    private readonly tokens: TokenService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async login(@Body() dto: StaffLoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password);

    this.cookies.setMfaChallenge(res, result.challengeToken, result.challengeExpiresAt);

    return { mfaRequired: true, enrolmentRequired: result.enrolmentRequired };
  }

  /** Public, and answers identically whether or not the address has an account. */
  @Post('forgot-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(AUTH_THROTTLE)
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.passwordReset.request(dto.email);
  }

  /** Public: it carries a token rather than a session, so CsrfGuard has nothing to check. */
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle(AUTH_THROTTLE)
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.passwordReset.reset(dto.token, dto.password);
  }

  @Post('2fa/enrol')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async enrol(@Req() req: Request) {
    const challenge = await this.requireChallenge(req);

    if (!challenge.enrolmentRequired) {
      throw new ForbiddenException('Two-factor authentication is already enabled');
    }

    const { otpauthUri, qrDataUrl, secret } = await this.auth.beginTotpEnrolment(challenge);

    return { otpauthUri, qrDataUrl, secret };
  }

  @Post('2fa/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  async verify(
    @Body() dto: TotpCodeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const challenge = await this.requireChallenge(req);
    const { session, user } = await this.auth.completeLogin(
      challenge,
      dto.code,
      requestContextOf(req),
    );

    this.cookies.clearMfaChallenge(res);
    const csrfToken = this.cookies.setSession(res, TokenAudience.Staff, session);

    return { csrfToken, user: toProfile(user) };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @UseGuards(CsrfGuard)
  @Throttle(AUTH_THROTTLE)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = readCookie(req, AuthCookie.StaffRefresh);

    if (!rawToken) {
      throw new UnauthorizedException('Invalid session');
    }

    const { session, user } = await this.auth.refresh(rawToken, requestContextOf(req));
    const csrfToken = this.cookies.setSession(res, TokenAudience.Staff, session);

    return { csrfToken, user: toProfile(user) };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(CsrfGuard)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readCookie(req, AuthCookie.StaffRefresh));
    this.cookies.clearSession(res, TokenAudience.Staff);
    this.cookies.clearMfaChallenge(res);
  }

  @Get('me')
  @UseGuards(StaffJwtGuard)
  async me(@CurrentUser() principal: StaffPrincipal) {
    const user = await this.auth.findById(principal.userId);

    if (!user) {
      throw new NotFoundException();
    }

    return toProfile(user);
  }

  private async requireChallenge(req: Request): Promise<MfaChallenge> {
    const token = readCookie(req, AuthCookie.StaffMfa);

    if (!token) {
      throw new UnauthorizedException('Two-factor challenge expired');
    }

    return this.tokens.verifyMfaChallenge(token);
  }
}

function readCookie(req: Request, name: string): string | undefined {
  return (req.cookies as Record<string, string> | undefined)?.[name];
}

function toProfile(user: {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role?: { name: string };
}) {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role?.name ?? null,
  };
}
