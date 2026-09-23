import { AppConfig } from './app-config';
import { configFor as baseConfigFor } from './app-config.fixture';
import { buildCorsOptions } from './cors.config';

function configFor(env: string, corsOrigins: string[]): AppConfig {
  return baseConfigFor({ NODE_ENV: env, CORS_ORIGINS: corsOrigins.join(',') });
}

describe('buildCorsOptions', () => {
  it('allows the configured origins with credentials', () => {
    const options = buildCorsOptions(configFor('development', ['http://localhost:5173']));

    expect(options.origin).toEqual(['http://localhost:5173']);
    expect(options.credentials).toBe(true);
  });

  it('permits the CSRF header, without which every write would be blocked', () => {
    const options = buildCorsOptions(configFor('development', ['http://localhost:5173']));

    expect(options.allowedHeaders).toContain('x-csrf-token');
  });

  it('refuses a wildcard origin, which credentials make meaningless', () => {
    expect(() => buildCorsOptions(configFor('development', ['*']))).toThrow(/cannot be "\*"/);
  });

  it('refuses to start in production with no origins listed', () => {
    expect(() => buildCorsOptions(configFor('production', []))).toThrow(/must list/);
  });

  it('refuses a plain-http origin in production', () => {
    expect(() => buildCorsOptions(configFor('production', ['http://tms.example.com']))).toThrow(
      /must be https/,
    );
  });

  it('accepts https origins in production', () => {
    const options = buildCorsOptions(configFor('production', ['https://tms.example.com']));

    expect(options.origin).toEqual(['https://tms.example.com']);
  });

  it('tolerates an empty list outside production, where the proxy is used instead', () => {
    expect(() => buildCorsOptions(configFor('development', []))).not.toThrow();
  });
});
