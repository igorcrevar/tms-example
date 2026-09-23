import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AppConfig } from '../../../config/app-config';
import { AuthCookie, TokenType } from '../auth.constants';
import { TokenAudience } from '../entities/refresh-token.entity';
import { fromAuthCookie } from './cookie-extractor';

export interface StaffPrincipal {
  userId: string;
  role: string;
  audience: TokenAudience.Staff;
}

@Injectable()
export class StaffJwtStrategy extends PassportStrategy(Strategy, 'staff-jwt') {
  constructor(config: AppConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([fromAuthCookie(AuthCookie.StaffAccess)]),
      ignoreExpiration: false,
      secretOrKey: config.auth.staff.accessSecret,
      audience: TokenAudience.Staff,
    });
  }

  validate(payload: { sub?: string; typ?: string; role?: string }): StaffPrincipal {
    // A refresh or MFA token must never be accepted as an access token.
    if (payload.typ !== TokenType.Access || !payload.sub) {
      throw new UnauthorizedException();
    }

    return { userId: payload.sub, role: payload.role ?? '', audience: TokenAudience.Staff };
  }
}
