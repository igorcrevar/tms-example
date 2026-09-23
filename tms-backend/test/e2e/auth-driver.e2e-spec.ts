import { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AuthCookie } from '../../src/modules/auth/auth.constants';
import {
  CookieJar,
  bodyOf,
  createDriver,
  createStaffUser,
  createTestApp,
  deleteUsersByEmail,
  setCookieFor,
} from './helpers';

const PIN = '482913';
const PASSWORD = 'correct horse battery staple';
const DRIVER_EMAIL = 'e2e-driver@tms.local';
const STAFF_EMAIL = 'e2e-driver-staff@tms.local';
const DRIVER_CODE = 'E2E-DRV-1';
const EMAILS = [DRIVER_EMAIL, STAFF_EMAIL];

describe('Driver authentication (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let totpSecret: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());

    await deleteUsersByEmail(dataSource, EMAILS);

    totpSecret = authenticator.generateSecret();
    await createDriver(dataSource, { email: DRIVER_EMAIL, driverCode: DRIVER_CODE, pin: PIN });
    await createStaffUser(dataSource, { email: STAFF_EMAIL, password: PASSWORD, totpSecret });
  });

  afterAll(async () => {
    await deleteUsersByEmail(dataSource, EMAILS);
    await app?.close();
  });

  async function loginDriver(): Promise<CookieJar> {
    const jar = new CookieJar();

    jar.capture(
      await request(app.getHttpServer())
        .post('/api/driver/auth/login')
        .send({ driverCode: DRIVER_CODE, pin: PIN })
        .expect(200),
    );

    return jar;
  }

  async function loginStaff(): Promise<CookieJar> {
    const jar = new CookieJar();

    jar.capture(
      await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: STAFF_EMAIL, password: PASSWORD })
        .expect(200),
    );
    jar.capture(
      await request(app.getHttpServer())
        .post('/api/staff/auth/2fa/verify')
        .set('Cookie', jar.header())
        .send({ code: authenticator.generate(totpSecret) })
        .expect(200),
    );

    return jar;
  }

  it('signs a driver in with a PIN and no second factor', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/driver/auth/login')
      .send({ driverCode: DRIVER_CODE, pin: PIN })
      .expect(200);

    expect(bodyOf<{ driver: unknown }>(response).driver).toMatchObject({
      driverCode: DRIVER_CODE,
      driverType: 'TRUCK',
    });
    expect(setCookieFor(response, AuthCookie.DriverAccess) ?? '').toContain('HttpOnly');
    expect(setCookieFor(response, AuthCookie.DriverRefresh) ?? '').toContain(
      'Path=/api/driver/auth',
    );
    expect(setCookieFor(response, AuthCookie.StaffAccess)).toBeUndefined();
  });

  it('rejects a wrong PIN and an unknown code identically', async () => {
    const wrongPin = await request(app.getHttpServer())
      .post('/api/driver/auth/login')
      .send({ driverCode: DRIVER_CODE, pin: '000000' })
      .expect(401);

    const unknown = await request(app.getHttpServer())
      .post('/api/driver/auth/login')
      .send({ driverCode: 'NOPE-1', pin: PIN })
      .expect(401);

    expect(bodyOf<{ message: string }>(wrongPin).message).toBe(
      bodyOf<{ message: string }>(unknown).message,
    );
  });

  it('rejects a non-numeric PIN before touching the database', async () => {
    await request(app.getHttpServer())
      .post('/api/driver/auth/login')
      .send({ driverCode: DRIVER_CODE, pin: 'abcdef' })
      .expect(400);
  });

  it('serves the driver profile from the driver cookie', async () => {
    const jar = await loginDriver();

    const response = await request(app.getHttpServer())
      .get('/api/driver/auth/me')
      .set('Cookie', jar.header())
      .expect(200);

    expect(bodyOf(response)).toMatchObject({ driverCode: DRIVER_CODE, driverType: 'TRUCK' });
  });

  describe('audience isolation', () => {
    it('refuses a driver token on the staff API', async () => {
      const jar = await loginDriver();

      await request(app.getHttpServer())
        .get('/api/staff/auth/me')
        .set('Cookie', jar.header())
        .expect(401);
    });

    it('refuses a staff token on the driver API', async () => {
      const jar = await loginStaff();

      await request(app.getHttpServer())
        .get('/api/driver/auth/me')
        .set('Cookie', jar.header())
        .expect(401);
    });

    it('refuses a driver refresh token renamed to the staff cookie', async () => {
      const jar = await loginDriver();
      const driverRefresh = jar.get(AuthCookie.DriverRefresh);

      await request(app.getHttpServer())
        .post('/api/staff/auth/refresh')
        .set('Cookie', `${AuthCookie.StaffRefresh}=${driverRefresh}; ${AuthCookie.StaffCsrf}=x`)
        .set('x-csrf-token', 'x')
        .expect(401);
    });
  });

  it('rotates the driver refresh token and rejects the replayed one', async () => {
    const jar = await loginDriver();
    const firstRefresh = jar.get(AuthCookie.DriverRefresh);

    jar.capture(
      await request(app.getHttpServer())
        .post('/api/driver/auth/refresh')
        .set('Cookie', jar.header())
        .set('x-csrf-token', jar.get(AuthCookie.DriverCsrf) ?? '')
        .expect(200),
    );

    expect(jar.get(AuthCookie.DriverRefresh)).not.toBe(firstRefresh);

    await request(app.getHttpServer())
      .post('/api/driver/auth/refresh')
      .set('Cookie', `${AuthCookie.DriverRefresh}=${firstRefresh}; ${AuthCookie.DriverCsrf}=x`)
      .set('x-csrf-token', 'x')
      .expect(401);
  });

  it('clears the session on logout', async () => {
    const jar = await loginDriver();
    const refreshBeforeLogout = jar.get(AuthCookie.DriverRefresh);

    await request(app.getHttpServer())
      .post('/api/driver/auth/logout')
      .set('Cookie', jar.header())
      .set('x-csrf-token', jar.get(AuthCookie.DriverCsrf) ?? '')
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/driver/auth/refresh')
      .set(
        'Cookie',
        `${AuthCookie.DriverRefresh}=${refreshBeforeLogout}; ${AuthCookie.DriverCsrf}=x`,
      )
      .set('x-csrf-token', 'x')
      .expect(401);
  });
});
