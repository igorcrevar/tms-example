import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { AppConfig } from '../../../config/app-config';
import { AuthCookie, TokenType } from '../auth.constants';
import { TokenAudience } from '../entities/refresh-token.entity';
import { fromAuthCookie } from './cookie-extractor';

export interface DriverPrincipal {
  userId: string;
  driverId: string;
  driverType: string;
  audience: TokenAudience.Driver;
}

@Injectable()
export class DriverJwtStrategy extends PassportStrategy(Strategy, 'driver-jwt') {
  constructor(config: AppConfig) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([fromAuthCookie(AuthCookie.DriverAccess)]),
      ignoreExpiration: false,
      secretOrKey: config.auth.driver.accessSecret,
      audience: TokenAudience.Driver,
    });
  }

  validate(payload: {
    sub?: string;
    typ?: string;
    driverId?: string;
    driverType?: string;
  }): DriverPrincipal {
    if (payload.typ !== TokenType.Access || !payload.sub || !payload.driverId) {
      throw new UnauthorizedException();
    }

    return {
      userId: payload.sub,
      driverId: payload.driverId,
      driverType: payload.driverType ?? '',
      audience: TokenAudience.Driver,
    };
  }
}
