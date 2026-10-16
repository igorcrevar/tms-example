import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AuthCookie } from '../../src/modules/auth/auth.constants';
import { User } from '../../src/modules/user/entities/user.entity';
import {
  CookieJar,
  bodyOf,
  createStaffUser,
  createTestApp,
  deleteUsersByEmail,
  mailboxSnapshot,
  signInStaff,
} from './helpers';

const PASSWORD = 'correct horse battery staple';
const ADMIN = 'e2e-me-admin@tms.local';
const TARGET_ONE = 'e2e-me-target-one@tms.local';
const TARGET_TWO = 'e2e-me-target-two@tms.local';
const GHOST = 'e2e-me-ghost@tms.local';
const EMAILS = [ADMIN, TARGET_ONE, TARGET_TWO, GHOST];

/** Matches the MAIL_DEV_DIR default and the filename scheme in MailService. */
const MAIL_DEV_DIR = './storage/dev-mail';

/** Waits for a message to EMAIL newer than SEEN and returns its raw content. */
async function waitForEml(email: string, seen: ReadonlySet<string>): Promise<string> {
  const suffix = `-${email.replace(/[^a-z0-9]/gi, '_')}.eml`;
  const dir = resolve(process.env.MAIL_DEV_DIR ?? MAIL_DEV_DIR);
  const deadline = Date.now() + 5000;

  for (;;) {
    const names: string[] = await readdir(dir).catch(() => []);
    const name = names.find((entry) => !seen.has(entry) && entry.endsWith(suffix));

    if (name) {
      return readFile(join(dir, name), 'utf8');
    }

    if (Date.now() >= deadline) {
      throw new Error(`No new message for ${email} in ${dir}`);
    }

    await delay(50);
  }
}

describe('Mass email (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let adminJar: CookieJar;
  let targetOneId: string;
  let targetTwoId: string;

  const csrf = (jar: CookieJar) => jar.get(AuthCookie.StaffCsrf) ?? '';

  const post = () =>
    request(app.getHttpServer())
      .post('/api/staff/users/mass-email')
      .set('Cookie', adminJar.header())
      .set('x-csrf-token', csrf(adminJar));

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    await deleteUsersByEmail(dataSource, EMAILS);

    const adminTotp = authenticator.generateSecret();

    await createStaffUser(dataSource, {
      email: ADMIN,
      password: PASSWORD,
      totpSecret: adminTotp,
    });
    targetOneId = (await createStaffUser(dataSource, { email: TARGET_ONE, password: PASSWORD })).id;
    targetTwoId = (await createStaffUser(dataSource, { email: TARGET_TWO, password: PASSWORD })).id;

    adminJar = await signInStaff(app, {
      email: ADMIN,
      password: PASSWORD,
      totpSecret: adminTotp,
    });
  });

  afterAll(async () => {
    await deleteUsersByEmail(dataSource, EMAILS);
    await app?.close();
  });

  it('mails every selected user and reports the count', async () => {
    const seen = await mailboxSnapshot();

    const response = await post()
      .send({
        userIds: [targetOneId, targetTwoId],
        subject: 'Maintenance window',
        body: 'TMS is down at noon.',
      })
      .expect(200);

    expect(bodyOf<{ sent: number; failed: unknown[] }>(response)).toEqual({
      sent: 2,
      failed: [],
    });

    const message = await waitForEml(TARGET_ONE, seen);
    expect(message).toContain('Maintenance window');
    expect(message).toContain('TMS is down at noon.');
    await waitForEml(TARGET_TWO, seen);

    const fresh = (await readdir(resolve(process.env.MAIL_DEV_DIR ?? MAIL_DEV_DIR))).filter(
      (name) => !seen.has(name),
    );
    for (const email of [TARGET_ONE, TARGET_TWO]) {
      const suffix = `-${email.replace(/[^a-z0-9]/gi, '_')}.eml`;
      expect(fresh.filter((name) => name.endsWith(suffix))).toHaveLength(1);
    }
  });

  it('rejects an unknown user id without sending anything', async () => {
    const seen = await mailboxSnapshot();
    const missingId = randomUUID();

    const response = await post()
      .send({ userIds: [targetOneId, missingId], subject: 's', body: 'b' })
      .expect(400);

    expect(bodyOf<{ unknownIds: string[] }>(response).unknownIds).toEqual([missingId]);
    await expect(waitForEml(TARGET_ONE, seen)).rejects.toThrow('No new message');
  }, 10_000);

  it('rejects a soft-deleted recipient', async () => {
    const ghost = await createStaffUser(dataSource, { email: GHOST, password: PASSWORD });
    await dataSource.getRepository(User).softDelete(ghost.id);

    await post()
      .send({ userIds: [ghost.id], subject: 's', body: 'b' })
      .expect(400);
  });

  it('rejects more than 100 ids', async () => {
    const userIds = Array.from({ length: 101 }, () => randomUUID());

    await post().send({ userIds, subject: 's', body: 'b' }).expect(400);
  });

  it('rejects an empty subject', async () => {
    await post()
      .send({ userIds: [targetOneId], subject: '', body: 'b' })
      .expect(400);
  });

  it('rejects a whitespace-only subject', async () => {
    await post()
      .send({ userIds: [targetOneId], subject: '   ', body: 'b' })
      .expect(400);
  });

  it('rejects a multi-line subject', async () => {
    await post()
      .send({ userIds: [targetOneId], subject: 'a\r\nb', body: 'b' })
      .expect(400);
  });

  it('rejects a whitespace-only body', async () => {
    await post()
      .send({ userIds: [targetOneId], subject: 's', body: '   ' })
      .expect(400);
  });

  it('rejects an empty body', async () => {
    await post()
      .send({ userIds: [targetOneId], subject: 's', body: '' })
      .expect(400);
  });

  it('refuses the request without a CSRF header', async () => {
    await request(app.getHttpServer())
      .post('/api/staff/users/mass-email')
      .set('Cookie', adminJar.header())
      .send({ userIds: [targetOneId], subject: 's', body: 'b' })
      .expect(403);
  });

  it('refuses the request without a session', async () => {
    await request(app.getHttpServer())
      .post('/api/staff/users/mass-email')
      .send({ userIds: [targetOneId], subject: 's', body: 'b' })
      .expect(401);
  });
});

describe('Mass email throttling (e2e)', () => {
  const email = 'e2e-me-throttle@tms.local';
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let adminJar: CookieJar;

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp({ throttle: true }));
    await deleteUsersByEmail(dataSource, [email]);

    const totpSecret = authenticator.generateSecret();

    await createStaffUser(dataSource, { email, password: PASSWORD, totpSecret });
    adminJar = await signInStaff(app, { email, password: PASSWORD, totpSecret });
  });

  afterAll(async () => {
    await deleteUsersByEmail(dataSource, [email]);
    await app?.close();
  });

  it('answers 429 once the mass-email limit is exceeded', async () => {
    // The unknown id keeps every attempt a 400; the throttler still counts them.
    const payload = { userIds: [randomUUID()], subject: 's', body: 'b' };

    const attempt = () =>
      request(app.getHttpServer())
        .post('/api/staff/users/mass-email')
        .set('Cookie', adminJar.header())
        .set('x-csrf-token', adminJar.get(AuthCookie.StaffCsrf) ?? '')
        .send(payload);

    for (let i = 0; i < 5; i += 1) {
      await attempt().expect(400);
    }

    await attempt().expect(429);
  });
});
