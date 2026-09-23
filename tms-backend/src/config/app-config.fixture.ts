import { AppConfig } from './app-config';

/** Just enough environment to pass validation; specs override what they exercise. */
export const TEST_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DB_PASSWORD: 'test',
  JWT_STAFF_ACCESS_SECRET: 'staff-access-secret-that-is-long-enough-000',
  JWT_STAFF_REFRESH_SECRET: 'staff-refresh-secret-that-is-long-enough-0',
  JWT_DRIVER_ACCESS_SECRET: 'driver-access-secret-that-is-long-enough-0',
  JWT_DRIVER_REFRESH_SECRET: 'driver-refresh-secret-that-is-long-enough',
};

export function configFor(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return AppConfig.load({ ...TEST_ENV, ...overrides });
}
