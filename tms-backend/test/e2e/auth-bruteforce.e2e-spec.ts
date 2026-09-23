import { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { createStaffUser, createTestApp, deleteUsersByEmail } from './helpers';

const PASSWORD = 'correct horse battery staple';
const WRONG = 'definitely not the password';

describe('Brute-force protection (e2e)', () => {
  describe('account lockout', () => {
    const email = 'e2e-lockout@tms.local';
    let app: INestApplication<App>;
    let dataSource: DataSource;

    beforeAll(async () => {
      // Rate limiting off so the per-account counter is what is under test.
      ({ app, dataSource } = await createTestApp());
      await deleteUsersByEmail(dataSource, [email]);
      await createStaffUser(dataSource, {
        email,
        password: PASSWORD,
        totpSecret: authenticator.generateSecret(),
      });
    });

    afterAll(async () => {
      await deleteUsersByEmail(dataSource, [email]);
      await app?.close();
    });

    it('locks the account after the configured failures and ignores the right password', async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(app.getHttpServer())
          .post('/api/staff/auth/login')
          .send({ email, password: WRONG })
          .expect(401);
      }

      const locked = await dataSource.query<Array<{ lockedUntil: Date | null }>>(
        'SELECT "lockedUntil" FROM users WHERE email = $1',
        [email],
      );

      expect(locked[0].lockedUntil).toBeInstanceOf(Date);

      // The correct password must not open a locked account.
      await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email, password: PASSWORD })
        .expect(401);
    });
  });

  describe('per-IP rate limiting', () => {
    const email = 'e2e-throttle@tms.local';
    let app: INestApplication<App>;
    let dataSource: DataSource;

    beforeAll(async () => {
      ({ app, dataSource } = await createTestApp({ throttle: true }));
      await deleteUsersByEmail(dataSource, [email]);
      await createStaffUser(dataSource, {
        email,
        password: PASSWORD,
        totpSecret: authenticator.generateSecret(),
      });
    });

    afterAll(async () => {
      await deleteUsersByEmail(dataSource, [email]);
      await app?.close();
    });

    it('answers 429 once the login limit is exceeded', async () => {
      const statuses: number[] = [];

      for (let attempt = 0; attempt < 7; attempt += 1) {
        const response = await request(app.getHttpServer())
          .post('/api/staff/auth/login')
          .send({ email: 'someone-else@tms.local', password: WRONG });

        statuses.push(response.status);
      }

      expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
      expect(statuses.slice(5)).toEqual([429, 429]);
    });
  });
});
