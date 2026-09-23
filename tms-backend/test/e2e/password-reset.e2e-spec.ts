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
  mailboxSnapshot,
  readTokenFromMailbox,
  signInStaff,
} from './helpers';

const PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'a brand new long password';
const ADMIN = 'e2e-pr-admin@tms.local';
const STAFF = 'e2e-pr-staff@tms.local';
const DRIVER_EMAIL = 'e2e-pr-driver@tms.local';
const UNKNOWN = 'e2e-pr-nobody@tms.local';
const REUSE = 'e2e-pr-reuse@tms.local';
const SUPERSEDED = 'e2e-pr-superseded@tms.local';
const NO_FACTOR = 'e2e-pr-nofactor@tms.local';
const STRIPPED = 'e2e-pr-stripped@tms.local';
const EMAILS = [ADMIN, STAFF, DRIVER_EMAIL, UNKNOWN, REUSE, SUPERSEDED, NO_FACTOR, STRIPPED];

/** `seen` holds every message already on disk, so a read cannot return an older token. */
const readResetToken = (email: string, seen: ReadonlySet<string>) =>
  readTokenFromMailbox(email, 'reset-password', seen);

describe('Password reset (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let adminJar: CookieJar;
  let staffTotp: string;
  let staffId: string;

  const csrf = (jar: CookieJar) => jar.get(AuthCookie.StaffCsrf) ?? '';

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    await deleteUsersByEmail(dataSource, EMAILS);

    const adminTotp = authenticator.generateSecret();
    staffTotp = authenticator.generateSecret();

    await createStaffUser(dataSource, { email: ADMIN, password: PASSWORD, totpSecret: adminTotp });
    staffId = (
      await createStaffUser(dataSource, {
        email: STAFF,
        password: PASSWORD,
        totpSecret: staffTotp,
      })
    ).id;
    await createDriver(dataSource, {
      email: DRIVER_EMAIL,
      driverCode: 'E2E-PR-1',
      pin: '482913',
    });

    for (const email of [REUSE, SUPERSEDED, STRIPPED]) {
      await createStaffUser(dataSource, {
        email,
        password: PASSWORD,
        totpSecret: authenticator.generateSecret(),
      });
    }

    // No authenticator at all: the state an invitee or an admin-assisted account sits in.
    await createStaffUser(dataSource, { email: NO_FACTOR, password: PASSWORD });

    adminJar = await signInStaff(app, { email: ADMIN, password: PASSWORD, totpSecret: adminTotp });
  });

  afterAll(async () => {
    await deleteUsersByEmail(dataSource, EMAILS);
    await app?.close();
  });

  function forgotPassword(email: string) {
    return request(app.getHttpServer()).post('/api/staff/auth/forgot-password').send({ email });
  }

  function resetPassword(token: string, password: string) {
    return request(app.getHttpServer())
      .post('/api/staff/auth/reset-password')
      .send({ token, password });
  }

  function tokenRowsFor(userId: string) {
    return dataSource.query<Array<{ tokenHash: string; usedAt: Date | null; purpose: string }>>(
      'SELECT "tokenHash", "usedAt", purpose FROM auth_tokens WHERE "userId" = $1',
      [userId],
    );
  }

  describe('requesting a reset', () => {
    it('answers identically for a real address and an unknown one', async () => {
      const seen = await mailboxSnapshot();
      const known = await forgotPassword(STAFF).expect(204);
      const unknown = await forgotPassword(UNKNOWN).expect(204);

      expect(known.text).toBe(unknown.text);
      expect(JSON.stringify(known.body)).toBe(JSON.stringify(unknown.body));

      // Wait for the detached delivery, so this message cannot land inside a later snapshot.
      await readResetToken(STAFF, seen);
    });

    it('stores only a hash of the token, never the token', async () => {
      const [row] = await tokenRowsFor(staffId);

      expect(row.tokenHash).toHaveLength(64);
      expect(row.purpose).toBe('PASSWORD_RESET');
      expect(row.usedAt).toBeNull();
    });

    it('issues nothing for a driver, who has no password', async () => {
      await forgotPassword(DRIVER_EMAIL).expect(204);

      const [driverUser] = await dataSource.query<Array<{ id: string }>>(
        'SELECT id FROM users WHERE email = $1',
        [DRIVER_EMAIL],
      );

      expect(await tokenRowsFor(driverUser.id)).toHaveLength(0);
    });
  });

  describe('using a reset token', () => {
    it('sets the new password, kills existing sessions and refuses the old one', async () => {
      const victimJar = await signInStaff(app, {
        email: STAFF,
        password: PASSWORD,
        totpSecret: staffTotp,
      });

      // Sanity: the session works before the reset.
      await request(app.getHttpServer())
        .post('/api/staff/auth/refresh')
        .set('Cookie', victimJar.header())
        .set('x-csrf-token', csrf(victimJar))
        .expect(200);

      const seen = await mailboxSnapshot();
      await forgotPassword(STAFF).expect(204);
      const token = await readResetToken(STAFF, seen);

      await resetPassword(token, NEW_PASSWORD).expect(204);

      // The session an attacker might be holding must not survive the reset.
      await request(app.getHttpServer())
        .post('/api/staff/auth/refresh')
        .set('Cookie', victimJar.header())
        .set('x-csrf-token', csrf(victimJar))
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: STAFF, password: PASSWORD })
        .expect(401);

      const login = await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: STAFF, password: NEW_PASSWORD })
        .expect(200);

      // The second factor survives a password reset: email alone is not enough.
      expect(bodyOf<{ enrolmentRequired: boolean }>(login).enrolmentRequired).toBe(false);
    });

    it('refuses to reuse the same token', async () => {
      const seen = await mailboxSnapshot();
      await forgotPassword(REUSE).expect(204);
      const token = await readResetToken(REUSE, seen);

      await resetPassword(token, 'a token spent exactly once').expect(204);
      await resetPassword(token, 'yet another long password').expect(404);
    });

    it('kills a second outstanding link once the first is spent', async () => {
      const beforeFirst = await mailboxSnapshot();
      await forgotPassword(SUPERSEDED).expect(204);
      const first = await readResetToken(SUPERSEDED, beforeFirst);

      const beforeSecond = await mailboxSnapshot();
      await forgotPassword(SUPERSEDED).expect(204);
      const second = await readResetToken(SUPERSEDED, beforeSecond);

      expect(second).not.toBe(first);

      await resetPassword(second, 'the link the owner actually used').expect(204);

      // A link captured earlier must not survive the victim's own reset.
      await resetPassword(first, 'the link an attacker captured').expect(404);
    });

    it('refuses an expired token', async () => {
      const seen = await mailboxSnapshot();
      await forgotPassword(STAFF).expect(204);
      const token = await readResetToken(STAFF, seen);

      await dataSource.query(
        `UPDATE auth_tokens SET "expiresAt" = now() - interval '1 minute'
         WHERE "userId" = $1 AND "usedAt" IS NULL`,
        [staffId],
      );

      await resetPassword(token, 'one more long password').expect(404);
    });

    it('refuses a token that was never issued', async () => {
      await resetPassword('not-a-real-token', 'one more long password').expect(404);
    });
  });

  describe('an account with no second factor', () => {
    it('answers identically to an unknown address and issues nothing', async () => {
      const bare = await forgotPassword(NO_FACTOR).expect(204);
      const unknown = await forgotPassword(UNKNOWN).expect(204);

      expect(bare.text).toBe(unknown.text);
      expect(JSON.stringify(bare.body)).toBe(JSON.stringify(unknown.body));

      const [user] = await dataSource.query<Array<{ id: string }>>(
        'SELECT id FROM users WHERE email = $1',
        [NO_FACTOR],
      );

      expect(await tokenRowsFor(user.id)).toHaveLength(0);
    });

    it('refuses a token issued before the factor was cleared', async () => {
      const seen = await mailboxSnapshot();
      await forgotPassword(STRIPPED).expect(204);
      const token = await readResetToken(STRIPPED, seen);

      // The window an admin opens by clearing a lost authenticator.
      await dataSource.query(
        'UPDATE users SET "totpSecret" = NULL, "totpEnabledAt" = NULL WHERE email = $1',
        [STRIPPED],
      );

      await resetPassword(token, 'a password an attacker chose').expect(404);
    });
  });

  describe('resetting a second factor', () => {
    it('clears the authenticator, ends the sessions and forces re-enrolment', async () => {
      const victimJar = await signInStaff(app, {
        email: STAFF,
        password: NEW_PASSWORD,
        totpSecret: staffTotp,
      });

      await request(app.getHttpServer())
        .delete(`/api/staff/users/${staffId}/two-factor`)
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .expect(204);

      const [row] = await dataSource.query<
        Array<{ totpSecret: string | null; totpEnabledAt: Date | null }>
      >('SELECT "totpSecret", "totpEnabledAt" FROM users WHERE id = $1', [staffId]);

      expect(row.totpSecret).toBeNull();
      expect(row.totpEnabledAt).toBeNull();

      await request(app.getHttpServer())
        .post('/api/staff/auth/refresh')
        .set('Cookie', victimJar.header())
        .set('x-csrf-token', csrf(victimJar))
        .expect(401);

      const login = await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: STAFF, password: NEW_PASSWORD })
        .expect(200);

      expect(bodyOf<{ enrolmentRequired: boolean }>(login).enrolmentRequired).toBe(true);
    });

    it('refuses an unauthenticated caller', async () => {
      await request(app.getHttpServer())
        .delete(`/api/staff/users/${staffId}/two-factor`)
        .expect(401);
    });
  });
});

describe('Password reset rate limiting (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    ({ app } = await createTestApp({ throttle: true }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('answers 429 once the forgot-password limit is exceeded', async () => {
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const response = await request(app.getHttpServer())
        .post('/api/staff/auth/forgot-password')
        .send({ email: UNKNOWN });

      statuses.push(response.status);
    }

    expect(statuses).toEqual([204, 204, 204, 204, 204, 429]);
  });
});
