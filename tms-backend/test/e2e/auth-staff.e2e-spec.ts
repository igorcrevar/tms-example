import { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AuthCookie } from '../../src/modules/auth/auth.constants';
import { UserStatus } from '../../src/modules/user/entities/user.entity';
import {
  CookieJar,
  bodyOf,
  createStaffUser,
  createTestApp,
  deleteUsersByEmail,
  setCookieFor,
  signInStaff,
} from './helpers';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'staple battery horse correct';
const ENROLLED = 'e2e-staff-enrolled@tms.local';
const PENDING = 'e2e-staff-pending@tms.local';
const INVITED = 'e2e-staff-invited@tms.local';
/** Its own account: the password change below must not break the sign-ins above. */
const CHANGER = 'e2e-staff-changer@tms.local';
const EMAILS = [ENROLLED, PENDING, INVITED, CHANGER];

describe('Staff authentication (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let totpSecret: string;
  let changerSecret: string;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());

    await deleteUsersByEmail(dataSource, EMAILS);

    totpSecret = authenticator.generateSecret();
    changerSecret = authenticator.generateSecret();
    await createStaffUser(dataSource, { email: ENROLLED, password: PASSWORD, totpSecret });
    await createStaffUser(dataSource, {
      email: CHANGER,
      password: PASSWORD,
      totpSecret: changerSecret,
    });
    await createStaffUser(dataSource, { email: PENDING, password: PASSWORD });
    await createStaffUser(dataSource, {
      email: INVITED,
      password: PASSWORD,
      totpSecret: authenticator.generateSecret(),
      status: UserStatus.Invited,
    });
  });

  afterAll(async () => {
    await deleteUsersByEmail(dataSource, EMAILS);
    await app?.close();
  });

  async function loginThroughTwoFactor(): Promise<CookieJar> {
    const jar = new CookieJar();

    jar.capture(
      await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: ENROLLED, password: PASSWORD })
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

  describe('password step', () => {
    it('returns an MFA challenge and no session cookie', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: ENROLLED, password: PASSWORD })
        .expect(200);

      expect(bodyOf(response)).toEqual({ mfaRequired: true, enrolmentRequired: false });
      expect(setCookieFor(response, AuthCookie.StaffMfa)).toBeDefined();
      expect(setCookieFor(response, AuthCookie.StaffAccess)).toBeUndefined();
      expect(setCookieFor(response, AuthCookie.StaffRefresh)).toBeUndefined();
    });

    it('marks the MFA cookie HttpOnly and SameSite', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: ENROLLED, password: PASSWORD })
        .expect(200);

      const cookie = setCookieFor(response, AuthCookie.StaffMfa) ?? '';

      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Strict');
    });

    it('rejects a wrong password and an unknown email the same way', async () => {
      const wrong = await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: ENROLLED, password: 'wrong password here' })
        .expect(401);

      const unknown = await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: 'nobody@tms.local', password: PASSWORD })
        .expect(401);

      expect(bodyOf<{ message: string }>(wrong).message).toBe(
        bodyOf<{ message: string }>(unknown).message,
      );
    });

    it('refuses a user who has not accepted their invitation', async () => {
      await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: INVITED, password: PASSWORD })
        .expect(401);
    });

    it('flags enrolment for a user without a confirmed authenticator', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: PENDING, password: PASSWORD })
        .expect(200);

      expect(bodyOf<{ enrolmentRequired: boolean }>(response).enrolmentRequired).toBe(true);
    });
  });

  describe('two-factor step', () => {
    it('sets HttpOnly session cookies and returns a CSRF token', async () => {
      const jar = new CookieJar();

      jar.capture(
        await request(app.getHttpServer())
          .post('/api/staff/auth/login')
          .send({ email: ENROLLED, password: PASSWORD })
          .expect(200),
      );

      const response = jar.capture(
        await request(app.getHttpServer())
          .post('/api/staff/auth/2fa/verify')
          .set('Cookie', jar.header())
          .send({ code: authenticator.generate(totpSecret) })
          .expect(200),
      );

      const verified = bodyOf<{ csrfToken: string; user: { email: string; role: string } }>(
        response,
      );

      expect(verified.csrfToken).toEqual(expect.any(String));
      expect(verified.user).toMatchObject({ email: ENROLLED, role: 'ADMIN' });

      const access = setCookieFor(response, AuthCookie.StaffAccess) ?? '';
      const refresh = setCookieFor(response, AuthCookie.StaffRefresh) ?? '';

      expect(access).toContain('HttpOnly');
      expect(refresh).toContain('HttpOnly');
      // The refresh cookie is scoped so it is not sent with ordinary API calls.
      expect(refresh).toContain('Path=/api/staff/auth');
      // The CSRF cookie must stay readable by JS for the double-submit check.
      expect(setCookieFor(response, AuthCookie.StaffCsrf) ?? '').not.toContain('HttpOnly');
    });

    it('rejects a wrong code', async () => {
      const jar = new CookieJar();

      jar.capture(
        await request(app.getHttpServer())
          .post('/api/staff/auth/login')
          .send({ email: ENROLLED, password: PASSWORD })
          .expect(200),
      );

      await request(app.getHttpServer())
        .post('/api/staff/auth/2fa/verify')
        .set('Cookie', jar.header())
        .send({ code: '000000' })
        .expect(401);
    });

    it('rejects a code with no challenge cookie', async () => {
      await request(app.getHttpServer())
        .post('/api/staff/auth/2fa/verify')
        .send({ code: authenticator.generate(totpSecret) })
        .expect(401);
    });
  });

  describe('session', () => {
    it('serves the profile from the access cookie', async () => {
      const jar = await loginThroughTwoFactor();

      const response = await request(app.getHttpServer())
        .get('/api/staff/auth/me')
        .set('Cookie', jar.header())
        .expect(200);

      expect(bodyOf(response)).toMatchObject({ email: ENROLLED, role: 'ADMIN' });
    });

    it('refuses the profile without cookies', async () => {
      await request(app.getHttpServer()).get('/api/staff/auth/me').expect(401);
    });

    it('rotates the refresh token and rejects the replayed one', async () => {
      const jar = await loginThroughTwoFactor();
      const firstRefresh = jar.get(AuthCookie.StaffRefresh);

      jar.capture(
        await request(app.getHttpServer())
          .post('/api/staff/auth/refresh')
          .set('Cookie', jar.header())
          .set('x-csrf-token', jar.get(AuthCookie.StaffCsrf) ?? '')
          .expect(200),
      );

      expect(jar.get(AuthCookie.StaffRefresh)).not.toBe(firstRefresh);

      // Replaying the consumed token must fail and kill the family.
      await request(app.getHttpServer())
        .post('/api/staff/auth/refresh')
        .set('Cookie', `${AuthCookie.StaffRefresh}=${firstRefresh}; ${AuthCookie.StaffCsrf}=x`)
        .set('x-csrf-token', 'x')
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/staff/auth/refresh')
        .set('Cookie', jar.header())
        .set('x-csrf-token', jar.get(AuthCookie.StaffCsrf) ?? '')
        .expect(401);
    });

    it('refuses a refresh without the CSRF header', async () => {
      const jar = await loginThroughTwoFactor();

      await request(app.getHttpServer())
        .post('/api/staff/auth/refresh')
        .set('Cookie', jar.header())
        .expect(403);
    });

    it('clears cookies on logout and invalidates the refresh token', async () => {
      const jar = await loginThroughTwoFactor();
      const refreshBeforeLogout = jar.get(AuthCookie.StaffRefresh);

      await request(app.getHttpServer())
        .post('/api/staff/auth/logout')
        .set('Cookie', jar.header())
        .set('x-csrf-token', jar.get(AuthCookie.StaffCsrf) ?? '')
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/staff/auth/refresh')
        .set(
          'Cookie',
          `${AuthCookie.StaffRefresh}=${refreshBeforeLogout}; ${AuthCookie.StaffCsrf}=x`,
        )
        .set('x-csrf-token', 'x')
        .expect(401);
    });
  });

  describe('change password', () => {
    it('refuses an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .post('/api/staff/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);
    });

    it('refuses a request without the CSRF header', async () => {
      const jar = await signInStaff(app, {
        email: CHANGER,
        password: PASSWORD,
        totpSecret: changerSecret,
      });

      await request(app.getHttpServer())
        .post('/api/staff/auth/change-password')
        .set('Cookie', jar.header())
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(403);
    });

    it('rejects a wrong current password with the login message', async () => {
      const jar = await signInStaff(app, {
        email: CHANGER,
        password: PASSWORD,
        totpSecret: changerSecret,
      });

      const response = await request(app.getHttpServer())
        .post('/api/staff/auth/change-password')
        .set('Cookie', jar.header())
        .set('x-csrf-token', jar.get(AuthCookie.StaffCsrf) ?? '')
        .send({ currentPassword: 'wrong password here', newPassword: NEW_PASSWORD })
        .expect(401);

      expect(bodyOf<{ message: string }>(response).message).toBe('Invalid credentials');
    });

    it('changes the password, ends the session and retires the old password', async () => {
      const jar = await signInStaff(app, {
        email: CHANGER,
        password: PASSWORD,
        totpSecret: changerSecret,
      });
      const refreshBefore = jar.get(AuthCookie.StaffRefresh);

      const response = jar.capture(
        await request(app.getHttpServer())
          .post('/api/staff/auth/change-password')
          .set('Cookie', jar.header())
          .set('x-csrf-token', jar.get(AuthCookie.StaffCsrf) ?? '')
          .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
          .expect(204),
      );

      expect(setCookieFor(response, AuthCookie.StaffAccess)).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(jar.has(AuthCookie.StaffRefresh)).toBe(false);

      await request(app.getHttpServer())
        .post('/api/staff/auth/refresh')
        .set('Cookie', `${AuthCookie.StaffRefresh}=${refreshBefore}; ${AuthCookie.StaffCsrf}=x`)
        .set('x-csrf-token', 'x')
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: CHANGER, password: PASSWORD })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: CHANGER, password: NEW_PASSWORD })
        .expect(200);
    });
  });
});
