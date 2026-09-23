import { Global, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SentryModule } from '@sentry/nestjs/setup';
import { WinstonModule } from 'nest-winston';

import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfig } from './config/app-config';
import { buildTypeOrmOptions } from './config/database.config';
import { buildWinstonOptions } from './config/logger.config';
import { AuthModule } from './modules/auth/auth.module';
import { DriverModule } from './modules/driver/driver.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationModule } from './modules/invitation/invitation.module';
import { UserModule } from './modules/user/user.module';

// Global so every module can inject AppConfig without importing anything.
@Global()
@Module({
  imports: [
    // SentryModule.forRoot() must come first so the SDK can hook into Nest.
    SentryModule.forRoot(),
    WinstonModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => buildWinstonOptions(config),
    }),
    TypeOrmModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => buildTypeOrmOptions(config),
    }),
    ThrottlerModule.forRootAsync({
      inject: [AppConfig],
      useFactory: (config: AppConfig) => ({
        throttlers: [{ ttl: config.app.throttleTtl, limit: config.app.throttleLimit }],
        skipIf: () => config.app.rateLimitDisabled,
      }),
    }),
    AuthModule,
    UserModule,
    DriverModule,
    InvitationModule,
    HealthModule,
  ],
  providers: [
    { provide: AppConfig, useFactory: () => AppConfig.load(process.env) },
    // Logs every exception and forwards it to Sentry; nothing below logs its own throws.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
  exports: [AppConfig],
})
export class AppModule {}
