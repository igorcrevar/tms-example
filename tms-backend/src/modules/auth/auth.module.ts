import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Driver } from '../driver/entities/driver.entity';
import { MailModule } from '../mail/mail.module';
import { Permission } from '../user/entities/permission.entity';
import { Role } from '../user/entities/role.entity';
import { User } from '../user/entities/user.entity';
import { DriverAuthController } from './controllers/driver-auth.controller';
import { StaffAuthController } from './controllers/staff-auth.controller';
import { StaffAuthService } from './services/staff-auth.service';
import { AuthToken } from './entities/auth-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { CookieService } from './services/cookie.service';
import { DriverAuthService } from './services/driver-auth.service';
import { LockoutService } from './services/lockout.service';
import { PasswordResetService } from './services/password-reset.service';
import { PasswordService } from './services/password.service';
import { TokenService } from './services/token.service';
import { TotpService } from './services/totp.service';
import { AbilityFactory } from './permissions/ability.factory';
import { PermissionsGuard } from './permissions/permissions.guard';
import { DriverJwtStrategy } from './strategies/driver-jwt.strategy';
import { StaffJwtStrategy } from './strategies/staff-jwt.strategy';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken, AuthToken, User, Role, Permission, Driver]),
    PassportModule,
    MailModule,
    // Secrets are passed per call: each audience signs with its own key.
    JwtModule.register({}),
  ],
  controllers: [StaffAuthController, DriverAuthController],
  providers: [
    CookieService,
    DriverAuthService,
    LockoutService,
    PasswordResetService,
    PasswordService,
    StaffAuthService,
    TokenService,
    TotpService,
    DriverJwtStrategy,
    StaffJwtStrategy,
    AbilityFactory,
    PermissionsGuard,
  ],
  exports: [PasswordService, TokenService, AbilityFactory, PermissionsGuard, TypeOrmModule],
})
export class AuthModule {}
