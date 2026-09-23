import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';

import { AppConfig } from '../../../config/app-config';
import { AuthCookie, CookiePath } from '../auth.constants';
import { TokenAudience } from '../entities/refresh-token.entity';
import type { IssuedSession } from './token.service';

@Injectable()
export class CookieService {
  constructor(private readonly config: AppConfig) {}

  /** Returns the CSRF token the client must echo back in a header. */
  setSession(res: Response, audience: TokenAudience, session: IssuedSession): string {
    const staff = audience === TokenAudience.Staff;

    res.cookie(
      staff ? AuthCookie.StaffAccess : AuthCookie.DriverAccess,
      session.accessToken,
      this.options(staff ? CookiePath.StaffApi : CookiePath.DriverApi, session.accessExpiresAt),
    );

    res.cookie(
      staff ? AuthCookie.StaffRefresh : AuthCookie.DriverRefresh,
      session.refreshToken,
      this.options(staff ? CookiePath.StaffAuth : CookiePath.DriverAuth, session.refreshExpiresAt),
    );

    const csrfToken = randomBytes(32).toString('hex');
    const cookieName = staff ? AuthCookie.StaffCsrf : AuthCookie.DriverCsrf;
    res.cookie(cookieName, csrfToken, {
      ...this.options(CookiePath.Root, session.refreshExpiresAt),
      httpOnly: false,
    });

    return csrfToken;
  }

  clearSession(res: Response, audience: TokenAudience): void {
    const staff = audience === TokenAudience.Staff;

    this.clear(
      res,
      staff ? AuthCookie.StaffAccess : AuthCookie.DriverAccess,
      staff ? CookiePath.StaffApi : CookiePath.DriverApi,
    );
    this.clear(
      res,
      staff ? AuthCookie.StaffRefresh : AuthCookie.DriverRefresh,
      staff ? CookiePath.StaffAuth : CookiePath.DriverAuth,
    );
    this.clear(res, staff ? AuthCookie.StaffCsrf : AuthCookie.DriverCsrf, CookiePath.Root);
  }

  setMfaChallenge(res: Response, token: string, expiresAt: Date): void {
    res.cookie(AuthCookie.StaffMfa, token, this.options(CookiePath.StaffAuth, expiresAt));
  }

  clearMfaChallenge(res: Response): void {
    this.clear(res, AuthCookie.StaffMfa, CookiePath.StaffAuth);
  }

  private clear(res: Response, name: AuthCookie, path: CookiePath): void {
    res.clearCookie(name, {
      httpOnly: name !== AuthCookie.StaffCsrf && name !== AuthCookie.DriverCsrf,
      secure: this.config.auth.cookieSecure,
      sameSite: this.config.auth.cookieSameSite,
      domain: this.config.auth.cookieDomain,
      path,
    });
  }

  private options(path: string, expiresAt: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.auth.cookieSecure,
      sameSite: this.config.auth.cookieSameSite,
      domain: this.config.auth.cookieDomain,
      path,
      expires: expiresAt,
    };
  }
}
