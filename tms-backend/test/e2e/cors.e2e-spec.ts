import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';

import { createTestApp } from './helpers';

const ALLOWED_ORIGIN = 'http://localhost:5173';
const FOREIGN_ORIGIN = 'https://evil.example.com';

describe('CORS (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    // createTestApp installs CORS from the same builder main.ts uses.
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await app?.close();
  });

  it('allows the configured frontend origin with credentials', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', ALLOWED_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not echo an unknown origin back', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', FOREIGN_ORIGIN);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('answers the preflight a cookie-authenticated write needs', async () => {
    const response = await request(app.getHttpServer())
      .options('/api/staff/auth/login')
      .set('Origin', ALLOWED_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token');

    expect(response.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-headers']?.toLowerCase()).toContain(
      'x-csrf-token',
    );
  });
});
