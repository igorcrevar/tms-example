import { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AuthCookie } from '../../src/modules/auth/auth.constants';
import { RoleName } from '../../src/modules/user/entities/role.entity';
import {
  CookieJar,
  bodyOf,
  createStaffUser,
  createTestApp,
  deleteUsersByEmail,
  mailboxSnapshot,
  readTokenFromMailbox,
  signInStaff,
} from './helpers';

const PASSWORD = 'correct horse battery staple';
const ADMIN = 'e2e-um-admin@tms.local';
const VICTIM = 'e2e-um-victim@tms.local';
const INVITEE = 'e2e-um-invitee@tms.local';
const DRIVER_EMAIL = 'e2e-um-driver@tms.local';
const SUPER = 'e2e-um-super@tms.local';
const SUPER_INVITEE = 'e2e-um-super-invitee@tms.local';
const ADMIN_INVITEE = 'e2e-um-admin-invitee@tms.local';
const EMAILS = [ADMIN, VICTIM, INVITEE, DRIVER_EMAIL, SUPER, SUPER_INVITEE, ADMIN_INVITEE];

interface UserSummary {
  id: string;
  email: string;
  status: string;
  role: string | null;
  driver: { id: string; driverCode: string } | null;
}

describe('User management (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let adminJar: CookieJar;
  let adminTotp: string;
  let victimTotp: string;
  let superTotp: string;

  const csrf = (jar: CookieJar) => jar.get(AuthCookie.StaffCsrf) ?? '';

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    await deleteUsersByEmail(dataSource, EMAILS);

    adminTotp = authenticator.generateSecret();
    victimTotp = authenticator.generateSecret();
    superTotp = authenticator.generateSecret();

    await createStaffUser(dataSource, { email: ADMIN, password: PASSWORD, totpSecret: adminTotp });
    await createStaffUser(dataSource, {
      email: VICTIM,
      password: PASSWORD,
      totpSecret: victimTotp,
    });
    await createStaffUser(dataSource, {
      email: SUPER,
      password: PASSWORD,
      totpSecret: superTotp,
      role: RoleName.SuperAdmin,
    });

    adminJar = await signInStaff(app, { email: ADMIN, password: PASSWORD, totpSecret: adminTotp });
  });

  afterAll(async () => {
    await deleteUsersByEmail(dataSource, EMAILS);
    await app?.close();
  });

  async function listUsers(jar: CookieJar, query = ''): Promise<UserSummary[]> {
    const response = await request(app.getHttpServer())
      .get(`/api/staff/users${query}`)
      .set('Cookie', jar.header())
      .expect(200);

    return bodyOf<{ items: UserSummary[] }>(response).items;
  }

  describe('listing', () => {
    it('shows other users but not the caller', async () => {
      const items = await listUsers(adminJar);
      const emails = items.map((user) => user.email);

      expect(emails).toContain(VICTIM);
      expect(emails).not.toContain(ADMIN);
    });

    it('never leaks a password hash or TOTP secret', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/staff/users')
        .set('Cookie', adminJar.header())
        .expect(200);

      const body = JSON.stringify(response.body);

      expect(body).not.toContain('passwordHash');
      expect(body).not.toContain('totpSecret');
      expect(body).not.toContain('pinHash');
      expect(body).not.toContain('$argon2');
    });

    it('filters to drivers only', async () => {
      await request(app.getHttpServer())
        .post('/api/staff/drivers')
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .send({
          driverCode: 'E2E-UM-1',
          firstName: 'Filter',
          lastName: 'Driver',
          email: DRIVER_EMAIL,
          driverType: 'TRUCK',
          pin: '482913',
        })
        .expect(201);

      const drivers = await listUsers(adminJar, '?role=DRIVER');
      const admins = await listUsers(adminJar, '?role=ADMIN');

      expect(drivers.every((user) => user.role === 'DRIVER')).toBe(true);
      expect(drivers.map((user) => user.email)).toContain(DRIVER_EMAIL);
      expect(admins.map((user) => user.email)).not.toContain(DRIVER_EMAIL);
    });
  });

  describe('invitations', () => {
    it('invites a user, who can then set a password and sign in', async () => {
      const invited = await request(app.getHttpServer())
        .post('/api/staff/invitations')
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .send({ email: INVITEE, firstName: 'New', lastName: 'Starter', role: 'ADMIN' })
        .expect(201);

      expect(bodyOf<UserSummary>(invited).status).toBe('INVITED');

      const [row] = await dataSource.query<Array<{ tokenHash: string }>>(
        'SELECT "tokenHash" FROM invitations WHERE "userId" = $1',
        [bodyOf<UserSummary>(invited).id],
      );
      expect(row.tokenHash).toHaveLength(64);

      // The token itself only exists in the email, so read it from the dev drop.
      const token = await readTokenFromMailbox(INVITEE, 'accept-invite');

      await request(app.getHttpServer())
        .get(`/api/staff/invitations/preview?token=${encodeURIComponent(token)}`)
        .expect(200);

      await request(app.getHttpServer())
        .post('/api/staff/invitations/accept')
        .send({ token, password: 'a brand new long password' })
        .expect(204);

      const [user] = await dataSource.query<Array<{ status: string; totpSecret: string | null }>>(
        'SELECT status, "totpSecret" FROM users WHERE email = $1',
        [INVITEE],
      );
      expect(user.status).toBe('ACTIVE');
      expect(user.totpSecret).toBeNull();

      // Signing in now behaves like any staff account: password, then enrolment.
      const login = await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: INVITEE, password: 'a brand new long password' })
        .expect(200);

      expect(bodyOf<{ enrolmentRequired: boolean }>(login).enrolmentRequired).toBe(true);
    });

    it('refuses to reuse the same invitation token', async () => {
      const token = await readTokenFromMailbox(INVITEE, 'accept-invite');

      await request(app.getHttpServer())
        .post('/api/staff/invitations/accept')
        .send({ token, password: 'yet another long password' })
        .expect(404);
    });

    it('refuses to invite a driver', async () => {
      await request(app.getHttpServer())
        .post('/api/staff/invitations')
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .send({ email: 'someone@tms.local', firstName: 'A', lastName: 'B', role: 'DRIVER' })
        .expect(400);
    });

    it('refuses a role that does not exist', async () => {
      await request(app.getHttpServer())
        .post('/api/staff/invitations')
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .send({ email: 'someone@tms.local', firstName: 'A', lastName: 'B', role: 'OVERLORD' })
        .expect(400);
    });

    it('refuses an ADMIN granting SUPER_ADMIN, which holds more than the caller does', async () => {
      await request(app.getHttpServer())
        .post('/api/staff/invitations')
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .send({ email: SUPER_INVITEE, firstName: 'Too', lastName: 'Much', role: 'SUPER_ADMIN' })
        .expect(403);
    });

    it('lets an ADMIN grant ADMIN, whose permissions it all holds', async () => {
      const invited = await request(app.getHttpServer())
        .post('/api/staff/invitations')
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .send({ email: ADMIN_INVITEE, firstName: 'Same', lastName: 'Level', role: 'ADMIN' })
        .expect(201);

      expect(bodyOf<UserSummary>(invited)).toMatchObject({ role: 'ADMIN' });
    });

    it('lets a SUPER_ADMIN grant SUPER_ADMIN', async () => {
      const superJar = await signInStaff(app, {
        email: SUPER,
        password: PASSWORD,
        totpSecret: superTotp,
      });

      await request(app.getHttpServer())
        .post('/api/staff/invitations')
        .set('Cookie', superJar.header())
        .set('x-csrf-token', csrf(superJar))
        .send({ email: SUPER_INVITEE, firstName: 'Just', lastName: 'Right', role: 'SUPER_ADMIN' })
        .expect(201);
    });

    it('resends an invitation with a new token and kills the old one', async () => {
      const invitee = (await listUsers(adminJar)).find((user) => user.email === ADMIN_INVITEE);
      const first = await readTokenFromMailbox(ADMIN_INVITEE, 'accept-invite');
      const seen = await mailboxSnapshot();

      await request(app.getHttpServer())
        .post(`/api/staff/invitations/${invitee!.id}/resend`)
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .expect(204);

      const second = await readTokenFromMailbox(ADMIN_INVITEE, 'accept-invite', seen);
      expect(second).not.toBe(first);

      await request(app.getHttpServer())
        .get(`/api/staff/invitations/preview?token=${encodeURIComponent(first)}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/staff/invitations/preview?token=${encodeURIComponent(second)}`)
        .expect(200);
    });

    it('refuses to resend to a user who has already accepted', async () => {
      const accepted = (await listUsers(adminJar)).find((user) => user.email === INVITEE);

      await request(app.getHttpServer())
        .post(`/api/staff/invitations/${accepted!.id}/resend`)
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .expect(400);
    });

    it('refuses to reset the second factor of a user who has not accepted yet', async () => {
      const invitee = (await listUsers(adminJar)).find((user) => user.email === ADMIN_INVITEE);

      await request(app.getHttpServer())
        .delete(`/api/staff/users/${invitee!.id}/two-factor`)
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .expect(400);
    });
  });

  describe('soft delete', () => {
    it('stops the deleted user authenticating and frees their email', async () => {
      const victim = (await listUsers(adminJar)).find((user) => user.email === VICTIM);
      expect(victim).toBeDefined();

      // Sanity: they can sign in before the delete.
      await signInStaff(app, { email: VICTIM, password: PASSWORD, totpSecret: victimTotp });

      await request(app.getHttpServer())
        .delete(`/api/staff/users/${victim!.id}`)
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .expect(204);

      // The row survives for audit...
      const [row] = await dataSource.query<Array<{ deletedAt: Date | null }>>(
        'SELECT "deletedAt" FROM users WHERE id = $1',
        [victim!.id],
      );
      expect(row.deletedAt).toBeInstanceOf(Date);

      // ...but must not authenticate any more.
      await request(app.getHttpServer())
        .post('/api/staff/auth/login')
        .send({ email: VICTIM, password: PASSWORD })
        .expect(401);

      // ...and must disappear from the list.
      expect((await listUsers(adminJar)).map((user) => user.email)).not.toContain(VICTIM);

      // ...and the address becomes invitable again.
      await request(app.getHttpServer())
        .post('/api/staff/invitations')
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .send({ email: VICTIM, firstName: 'Second', lastName: 'Chance', role: 'ADMIN' })
        .expect(201);
    });

    it('refuses to delete a SUPER_ADMIN, whoever asks', async () => {
      const superUser = (await listUsers(adminJar)).find((user) => user.email === SUPER);

      await request(app.getHttpServer())
        .delete(`/api/staff/users/${superUser!.id}`)
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .expect(403);

      const superJar = await signInStaff(app, {
        email: SUPER,
        password: PASSWORD,
        totpSecret: superTotp,
      });
      const other = (await listUsers(superJar)).find((user) => user.email === SUPER_INVITEE);

      await request(app.getHttpServer())
        .delete(`/api/staff/users/${other!.id}`)
        .set('Cookie', superJar.header())
        .set('x-csrf-token', csrf(superJar))
        .expect(403);

      const [row] = await dataSource.query<Array<{ deletedAt: Date | null }>>(
        'SELECT "deletedAt" FROM users WHERE id = $1',
        [superUser!.id],
      );
      expect(row.deletedAt).toBeNull();
    });

    it('refuses to delete yourself', async () => {
      const me = await request(app.getHttpServer())
        .get('/api/staff/auth/me')
        .set('Cookie', adminJar.header())
        .expect(200);

      await request(app.getHttpServer())
        .delete(`/api/staff/users/${bodyOf<{ id: string }>(me).id}`)
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .expect(400);
    });
  });

  describe('drivers', () => {
    it('changes a PIN and invalidates the old one', async () => {
      const driver = (await listUsers(adminJar, '?role=DRIVER')).find(
        (user) => user.email === DRIVER_EMAIL,
      );

      await request(app.getHttpServer())
        .post('/api/driver/auth/login')
        .send({ driverCode: 'E2E-UM-1', pin: '482913' })
        .expect(200);

      await request(app.getHttpServer())
        .put(`/api/staff/drivers/${driver!.driver!.id}/pin`)
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', csrf(adminJar))
        .send({ pin: '918273' })
        .expect(204);

      await request(app.getHttpServer())
        .post('/api/driver/auth/login')
        .send({ driverCode: 'E2E-UM-1', pin: '482913' })
        .expect(401);

      await request(app.getHttpServer())
        .post('/api/driver/auth/login')
        .send({ driverCode: 'E2E-UM-1', pin: '918273' })
        .expect(200);
    });
  });
});
