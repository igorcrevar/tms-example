import { AppConfig, Environment } from './app-config';
import { configFor, TEST_ENV } from './app-config.fixture';

describe('AppConfig', () => {
  it('applies defaults and converts values once', () => {
    const config = configFor({
      PORT: '4000',
      CORS_ORIGINS: ' http://a.local, http://b.local ,',
      JWT_STAFF_ACCESS_TTL: '15m',
      AUTH_COOKIE_SECURE: 'false',
      AUTH_MAX_FAILED_ATTEMPTS: '3',
      MFA_ENROLMENT_TTL: '20m',
    });

    expect(config.app.port).toBe(4000);
    expect(config.app.corsOrigins).toEqual(['http://a.local', 'http://b.local']);
    expect(config.auth.staff.accessTtl).toBe(900);
    expect(config.auth.driver.refreshTtl).toBe(2592000);
    expect(config.auth.mfaChallengeTtl).toBe(300);
    expect(config.auth.mfaEnrolmentTtl).toBe(1200);
    expect(config.auth.cookieSecure).toBe(false);
    expect(config.auth.cookieDomain).toBeUndefined();
    expect(config.auth.maxFailedAttempts).toBe(3);
    expect(config.database.port).toBe(5432);
  });

  it('refuses a missing DB_PASSWORD, naming the property but never a value', () => {
    const env: NodeJS.ProcessEnv = { ...TEST_ENV, JWT_STAFF_ACCESS_SECRET: 'short-value' };
    delete env.DB_PASSWORD;
    let message = '';

    try {
      AppConfig.load(env);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/DB_PASSWORD: .*must be a string/);
    expect(message).toMatch(/JWT_STAFF_ACCESS_SECRET: .*32 characters/);
    expect(message).not.toContain('short-value');
  });

  it('rejects an out-of-range port and an unknown NODE_ENV', () => {
    expect(() => configFor({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => configFor({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });

  it('ignores the rate-limit seam in production', () => {
    expect(configFor({ RATE_LIMIT_DISABLED: 'true' }).app.rateLimitDisabled).toBe(true);
    expect(
      configFor({ NODE_ENV: Environment.Production, RATE_LIMIT_DISABLED: 'true' }).app
        .rateLimitDisabled,
    ).toBe(false);
  });
});
