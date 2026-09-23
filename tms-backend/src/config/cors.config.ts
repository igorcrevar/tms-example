import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

import { CSRF_HEADER } from '../modules/auth/auth.constants';
import { AppConfig, Environment } from './app-config';

/**
 * The session is a cookie, so every browser call is credentialed. That makes
 * the origin list a security control rather than a convenience: a wrong entry
 * hands another site the ability to act as the signed-in user.
 */
export function buildCorsOptions(config: AppConfig): CorsOptions {
  const origins = config.app.corsOrigins;
  const isProduction = config.app.env === Environment.Production;

  // Browsers reject '*' alongside credentials; fail loudly rather than at runtime.
  if (origins.includes('*')) {
    throw new Error('CORS_ORIGINS cannot be "*" while credentials are enabled');
  }

  if (isProduction) {
    if (origins.length === 0) {
      throw new Error('CORS_ORIGINS must list the frontend origins in production');
    }

    const insecure = origins.filter((origin) => !origin.startsWith('https://'));

    if (insecure.length > 0) {
      throw new Error(`CORS_ORIGINS must be https in production: ${insecure.join(', ')}`);
    }
  }

  return {
    origin: origins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept', CSRF_HEADER],
    maxAge: 600,
  };
}
