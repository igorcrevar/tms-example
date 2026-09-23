import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { AuthCookie, CookiePath, CSRF_HEADER } from '../auth.constants';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Double-submit check: the client must echo the non-HttpOnly CSRF cookie in a
 * header, which a cross-site attacker cannot read.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const cookieName = request.path.startsWith(CookiePath.DriverApi)
      ? AuthCookie.DriverCsrf
      : AuthCookie.StaffCsrf;
    const cookieToken = (request.cookies as Record<string, string> | undefined)?.[cookieName];
    const headerToken = request.headers[CSRF_HEADER];

    if (!cookieToken || typeof headerToken !== 'string' || !equals(cookieToken, headerToken)) {
      throw new ForbiddenException('CSRF token mismatch');
    }

    return true;
  }
}

/** Hashed first so timingSafeEqual always sees equal-length buffers. */
function equals(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();

  return timingSafeEqual(left, right);
}
