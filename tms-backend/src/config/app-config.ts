import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import {
  IsBooleanString,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';
import { config as loadEnv } from 'dotenv';

import { durationToSeconds } from '../common/utils/duration';

loadEnv();

export enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export type CookieSameSite = 'strict' | 'lax' | 'none';

export interface AudienceSecrets {
  readonly accessSecret: string;
  readonly refreshSecret: string;
  /** Seconds — jsonwebtoken and cookie maxAge both take numbers. */
  readonly accessTtl: number;
  readonly refreshTtl: number;
}

/** Long enough that a leaked-but-truncated value is still useless. */
const MIN_SECRET_LENGTH = 32;

/** Raw variables as declared; the decorator on each field is what drives its type conversion. */
class EnvironmentVariables {
  @IsEnum(Environment)
  @IsOptional()
  NODE_ENV?: Environment;

  @IsNumber()
  @Min(1)
  @Max(65535)
  @IsOptional()
  PORT?: number;

  @IsString()
  @IsOptional()
  CORS_ORIGINS?: string;

  @IsNumber()
  @IsOptional()
  THROTTLE_TTL?: number;

  @IsNumber()
  @IsOptional()
  THROTTLE_LIMIT?: number;

  @IsString()
  @IsOptional()
  RATE_LIMIT_DISABLED?: string;

  @IsString()
  @IsOptional()
  DB_HOST?: string;

  @IsNumber()
  @IsOptional()
  DB_PORT?: number;

  @IsString()
  @IsOptional()
  DB_USERNAME?: string;

  @IsString()
  DB_PASSWORD!: string;

  @IsString()
  @IsOptional()
  DB_NAME?: string;

  @IsString()
  @IsOptional()
  DB_LOGGING?: string;

  // No defaults for these: a fallback secret is a hardcoded credential.
  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  JWT_STAFF_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  JWT_STAFF_REFRESH_SECRET!: string;

  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  JWT_DRIVER_ACCESS_SECRET!: string;

  @IsString()
  @MinLength(MIN_SECRET_LENGTH)
  JWT_DRIVER_REFRESH_SECRET!: string;

  @IsString()
  @IsOptional()
  JWT_STAFF_ACCESS_TTL?: string;

  @IsString()
  @IsOptional()
  JWT_STAFF_REFRESH_TTL?: string;

  @IsString()
  @IsOptional()
  JWT_DRIVER_ACCESS_TTL?: string;

  @IsString()
  @IsOptional()
  JWT_DRIVER_REFRESH_TTL?: string;

  @IsString()
  @IsOptional()
  MFA_CHALLENGE_TTL?: string;

  @IsString()
  @IsOptional()
  AUTH_COOKIE_DOMAIN?: string;

  @IsBooleanString()
  @IsOptional()
  AUTH_COOKIE_SECURE?: string;

  @IsIn(['strict', 'lax', 'none'])
  @IsOptional()
  AUTH_COOKIE_SAMESITE?: CookieSameSite;

  @IsNumber()
  @Min(1)
  @IsOptional()
  AUTH_MAX_FAILED_ATTEMPTS?: number;

  @IsNumber()
  @IsOptional()
  AUTH_LOCKOUT_MS?: number;

  @IsString()
  @IsOptional()
  TOTP_ISSUER?: string;

  @IsNumber()
  @IsOptional()
  TOTP_WINDOW?: number;

  // Only the seed script needs these, so the API must boot without them.
  @IsString()
  @IsOptional()
  SUPER_ADMIN_EMAIL?: string;

  @IsString()
  @IsOptional()
  SUPER_ADMIN_PASSWORD?: string;

  @IsString()
  @IsOptional()
  SUPER_ADMIN_FIRST_NAME?: string;

  @IsString()
  @IsOptional()
  SUPER_ADMIN_LAST_NAME?: string;

  @IsString()
  @IsOptional()
  MAIL_HOST?: string;

  @IsNumber()
  @IsOptional()
  MAIL_PORT?: number;

  @IsString()
  @IsOptional()
  MAIL_SECURE?: string;

  @IsString()
  @IsOptional()
  MAIL_USER?: string;

  @IsString()
  @IsOptional()
  MAIL_PASSWORD?: string;

  @IsString()
  @IsOptional()
  MAIL_FROM?: string;

  @IsString()
  @IsOptional()
  MAIL_DEV_DIR?: string;

  @IsString()
  @IsOptional()
  INVITATION_TTL?: string;

  @IsString()
  @IsOptional()
  INVITATION_ACCEPT_URL?: string;

  @IsString()
  @IsOptional()
  PASSWORD_RESET_TTL?: string;

  @IsString()
  @IsOptional()
  PASSWORD_RESET_URL?: string;

  @IsString()
  @IsOptional()
  LOG_LEVEL?: string;

  @IsString()
  @IsOptional()
  LOG_DIR?: string;

  @IsString()
  @IsOptional()
  LOG_MAX_FILES?: string;

  @IsString()
  @IsOptional()
  LOG_MAX_SIZE?: string;

  @IsString()
  @IsOptional()
  SENTRY_DSN?: string;

  @IsNumber()
  @IsOptional()
  SENTRY_TRACES_SAMPLE_RATE?: number;

  @IsNumber()
  @IsOptional()
  SENTRY_PROFILES_SAMPLE_RATE?: number;

  @IsString()
  @IsOptional()
  SENTRY_RELEASE?: string;
}

/**
 * The one typed view of the environment. Built and validated once by
 * `AppConfig.load`, provided by `AppModule`, injected everywhere else.
 */
@Injectable()
export class AppConfig {
  readonly app: {
    readonly env: Environment;
    readonly port: number;
    readonly corsOrigins: string[];
    readonly throttleTtl: number;
    readonly throttleLimit: number;
    readonly rateLimitDisabled: boolean;
  };

  readonly database: {
    readonly host: string;
    readonly port: number;
    readonly username: string;
    readonly password: string;
    readonly name: string;
    readonly logging: boolean;
  };

  readonly auth: {
    // Separate secrets per audience: a driver token presented to the staff API
    // fails signature verification, not merely an authorization check.
    readonly staff: AudienceSecrets;
    readonly driver: AudienceSecrets;
    readonly mfaChallengeTtl: number;
    readonly cookieDomain: string | undefined;
    readonly cookieSecure: boolean;
    readonly cookieSameSite: CookieSameSite;
    readonly maxFailedAttempts: number;
    readonly lockoutMs: number;
    readonly totpIssuer: string;
    readonly totpWindow: number;
  };

  readonly mail: {
    readonly host: string;
    readonly port: number;
    readonly secure: boolean;
    readonly user: string;
    readonly password: string;
    readonly from: string;
    readonly devDir: string;
  };

  readonly invitation: {
    readonly ttlSeconds: number;
    readonly acceptUrl: string;
  };

  readonly passwordReset: {
    readonly ttlSeconds: number;
    readonly resetUrl: string;
  };

  readonly superAdmin: {
    readonly email: string;
    readonly password: string;
    readonly firstName: string;
    readonly lastName: string;
  };

  readonly logger: {
    readonly level: string;
    readonly dir: string;
    readonly maxFiles: string;
    readonly maxSize: string;
  };

  readonly sentry: {
    readonly dsn: string;
    readonly tracesSampleRate: number;
    readonly profilesSampleRate: number;
    readonly release: string;
  };

  private constructor(env: EnvironmentVariables) {
    const production = env.NODE_ENV === Environment.Production;

    this.app = {
      env: env.NODE_ENV ?? Environment.Development,
      port: env.PORT ?? 3000,
      corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      throttleTtl: env.THROTTLE_TTL ?? 60_000,
      throttleLimit: env.THROTTLE_LIMIT ?? 100,
      // Test-only seam; ignored outside development so it cannot disarm production.
      rateLimitDisabled: !production && env.RATE_LIMIT_DISABLED === 'true',
    };

    this.database = {
      host: env.DB_HOST ?? 'localhost',
      port: env.DB_PORT ?? 5432,
      username: env.DB_USERNAME ?? 'tms',
      password: env.DB_PASSWORD,
      name: env.DB_NAME ?? 'tms',
      logging: env.DB_LOGGING === 'true',
    };

    this.auth = {
      staff: {
        accessSecret: env.JWT_STAFF_ACCESS_SECRET,
        refreshSecret: env.JWT_STAFF_REFRESH_SECRET,
        accessTtl: durationToSeconds(env.JWT_STAFF_ACCESS_TTL ?? '10m', 600),
        refreshTtl: durationToSeconds(env.JWT_STAFF_REFRESH_TTL ?? '7d', 604800),
      },
      driver: {
        accessSecret: env.JWT_DRIVER_ACCESS_SECRET,
        refreshSecret: env.JWT_DRIVER_REFRESH_SECRET,
        accessTtl: durationToSeconds(env.JWT_DRIVER_ACCESS_TTL ?? '10m', 600),
        refreshTtl: durationToSeconds(env.JWT_DRIVER_REFRESH_TTL ?? '30d', 2592000),
      },
      mfaChallengeTtl: durationToSeconds(env.MFA_CHALLENGE_TTL ?? '5m', 300),
      cookieDomain: env.AUTH_COOKIE_DOMAIN || undefined,
      cookieSecure: env.AUTH_COOKIE_SECURE !== 'false',
      cookieSameSite: env.AUTH_COOKIE_SAMESITE ?? 'strict',
      maxFailedAttempts: env.AUTH_MAX_FAILED_ATTEMPTS ?? 5,
      lockoutMs: env.AUTH_LOCKOUT_MS ?? 15 * 60 * 1000,
      totpIssuer: env.TOTP_ISSUER ?? 'TMS',
      totpWindow: env.TOTP_WINDOW ?? 1,
    };

    this.mail = {
      host: env.MAIL_HOST ?? '',
      port: env.MAIL_PORT ?? 587,
      secure: env.MAIL_SECURE === 'true',
      user: env.MAIL_USER ?? '',
      password: env.MAIL_PASSWORD ?? '',
      from: env.MAIL_FROM ?? 'TMS <no-reply@tms.local>',
      // Development .eml drops. Deliberately outside LOG_DIR: these contain live
      // activation tokens and must not be swept up by a log shipper.
      devDir: env.MAIL_DEV_DIR ?? './storage/dev-mail',
    };

    this.invitation = {
      ttlSeconds: durationToSeconds(env.INVITATION_TTL ?? '7d', 604800),
      acceptUrl: env.INVITATION_ACCEPT_URL ?? 'http://localhost:5173/admin/accept-invite',
    };

    this.passwordReset = {
      // Far shorter than an invitation: this link reaches an account that already exists.
      ttlSeconds: durationToSeconds(env.PASSWORD_RESET_TTL ?? '1h', 3600),
      resetUrl: env.PASSWORD_RESET_URL ?? 'http://localhost:5173/admin/reset-password',
    };

    this.superAdmin = {
      email: env.SUPER_ADMIN_EMAIL ?? '',
      password: env.SUPER_ADMIN_PASSWORD ?? '',
      firstName: env.SUPER_ADMIN_FIRST_NAME ?? 'Super',
      lastName: env.SUPER_ADMIN_LAST_NAME ?? 'Admin',
    };

    this.logger = {
      level: env.LOG_LEVEL ?? 'info',
      dir: env.LOG_DIR ?? './logs',
      maxFiles: env.LOG_MAX_FILES ?? '14d',
      maxSize: env.LOG_MAX_SIZE ?? '20m',
    };

    this.sentry = {
      dsn: env.SENTRY_DSN ?? '',
      tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1,
      profilesSampleRate: env.SENTRY_PROFILES_SAMPLE_RATE ?? 0.1,
      release: env.SENTRY_RELEASE ?? '',
    };
  }

  static load(source: NodeJS.ProcessEnv = process.env): AppConfig {
    const env = plainToInstance(EnvironmentVariables, source, { enableImplicitConversion: true });
    const errors = validateSync(env, { skipMissingProperties: false });

    if (errors.length > 0) {
      // Print property names and constraints only; values may be secrets.
      const detail = errors
        .map((error) => `${error.property}: ${Object.values(error.constraints ?? {}).join(', ')}`)
        .join('\n');

      throw new Error(`Invalid environment configuration:\n${detail}`);
    }

    return new AppConfig(env);
  }
}
