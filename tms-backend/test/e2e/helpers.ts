import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Response } from 'supertest';
import { DataSource } from 'typeorm';
import type { App } from 'supertest/types';

import { AppModule } from '../../src/app.module';
import { AppConfig } from '../../src/config/app-config';
import { buildCorsOptions } from '../../src/config/cors.config';
import { PasswordService } from '../../src/modules/auth/services/password.service';
import { Driver, DriverType } from '../../src/modules/driver/entities/driver.entity';
import { Role, RoleName } from '../../src/modules/user/entities/role.entity';
import { User, UserStatus } from '../../src/modules/user/entities/user.entity';

export interface TestApp {
  app: INestApplication<App>;
  dataSource: DataSource;
}

/** Mirrors the middleware main.ts installs, so cookies behave as in production. */
export async function createTestApp(options: { throttle?: boolean } = {}): Promise<TestApp> {
  // Set before the module compiles: AppConfig reads env during initialisation.
  process.env.RATE_LIMIT_DISABLED = options.throttle ? 'false' : 'true';

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleFixture.createNestApplication<INestApplication<App>>();

  app.use(cookieParser());
  app.enableCors(buildCorsOptions(app.get(AppConfig)));
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );

  await app.init();

  return { app, dataSource: app.get(DataSource) };
}

export async function createStaffUser(
  dataSource: DataSource,
  params: {
    email: string;
    password: string;
    totpSecret?: string;
    status?: UserStatus;
    role?: RoleName;
  },
): Promise<User> {
  const passwords = new PasswordService();
  const role = await dataSource
    .getRepository(Role)
    .findOneByOrFail({ name: params.role ?? RoleName.Admin });

  return dataSource.getRepository(User).save(
    dataSource.getRepository(User).create({
      email: params.email,
      firstName: 'Test',
      lastName: 'Staff',
      passwordHash: await passwords.hash(params.password),
      status: params.status ?? UserStatus.Active,
      totpSecret: params.totpSecret ?? null,
      totpEnabledAt: params.totpSecret ? new Date() : null,
      roleId: role.id,
    }),
  );
}

export async function createDriver(
  dataSource: DataSource,
  params: { email: string; driverCode: string; pin: string },
): Promise<Driver> {
  const passwords = new PasswordService();
  const role = await dataSource.getRepository(Role).findOneByOrFail({ name: RoleName.Driver });

  const user = await dataSource.getRepository(User).save(
    dataSource.getRepository(User).create({
      email: params.email,
      firstName: 'Test',
      lastName: 'Driver',
      passwordHash: null,
      status: UserStatus.Active,
      roleId: role.id,
    }),
  );

  return dataSource.getRepository(Driver).save(
    dataSource.getRepository(Driver).create({
      driverCode: params.driverCode,
      userId: user.id,
      driverType: DriverType.Truck,
      pinHash: await passwords.hash(params.pin),
      pinUpdatedAt: new Date(),
    }),
  );
}

export async function deleteUsersByEmail(dataSource: DataSource, emails: string[]): Promise<void> {
  // Raw SQL so soft-deleted rows are cleaned up too; the repository hides them.
  const users = await dataSource.query<Array<{ id: string }>>(
    'SELECT id FROM users WHERE email = ANY($1)',
    [emails],
  );

  for (const user of users) {
    await dataSource.query('DELETE FROM auth_tokens WHERE "userId" = $1', [user.id]);
    await dataSource.query('DELETE FROM invitations WHERE "userId" = $1', [user.id]);
    await dataSource.query('DELETE FROM invitations WHERE "invitedById" = $1', [user.id]);
    await dataSource.query('DELETE FROM refresh_tokens WHERE "userId" = $1', [user.id]);
    await dataSource.query('DELETE FROM drivers WHERE "userId" = $1', [user.id]);
    await dataSource.query('DELETE FROM users WHERE id = $1', [user.id]);
  }
}

/** Signs a staff user in through password + TOTP and returns the cookie jar. */
export async function signInStaff(
  app: INestApplication<App>,
  params: { email: string; password: string; totpSecret: string },
): Promise<CookieJar> {
  const { authenticator } = await import('otplib');
  const request = (await import('supertest')).default;
  const jar = new CookieJar();

  jar.capture(
    await request(app.getHttpServer())
      .post('/api/staff/auth/login')
      .send({ email: params.email, password: params.password })
      .expect(200),
  );

  jar.capture(
    await request(app.getHttpServer())
      .post('/api/staff/auth/2fa/verify')
      .set('Cookie', jar.header())
      .send({ code: authenticator.generate(params.totpSecret) })
      .expect(200),
  );

  return jar;
}

/** Minimal cookie jar: supertest has none, and these flows are cookie-driven. */
export class CookieJar {
  private readonly jar = new Map<string, string>();

  capture(response: Response): Response {
    for (const raw of setCookies(response)) {
      const [pair] = raw.split(';');
      const separator = pair.indexOf('=');
      const name = pair.slice(0, separator);
      const value = pair.slice(separator + 1);

      if (value === '') {
        this.jar.delete(name);
      } else {
        this.jar.set(name, value);
      }
    }

    return response;
  }

  header(): string {
    return [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  get(name: string): string | undefined {
    return this.jar.get(name);
  }

  has(name: string): boolean {
    return this.jar.has(name);
  }
}

export function setCookieFor(response: Response, name: string): string | undefined {
  return setCookies(response).find((raw) => raw.startsWith(`${name}=`));
}

function setCookies(response: Response): string[] {
  const header = response.headers['set-cookie'] as unknown;

  if (Array.isArray(header)) {
    return header as string[];
  }

  return typeof header === 'string' ? [header] : [];
}

/** supertest types `body` as `any`; funnel reads through one explicit cast. */
export function bodyOf<T>(response: Response): T {
  return response.body as T;
}

/** Matches the `MAIL_DEV_DIR` default in src/config/configuration.ts. */
const MAIL_DEV_DIR = './storage/dev-mail';
const MAILBOX_POLL_MS = 50;
const MAILBOX_TIMEOUT_MS = 5000;

/** The names already on disk, so a later read can tell a new message from a predecessor. */
export async function mailboxSnapshot(): Promise<Set<string>> {
  return new Set(await mailboxNames());
}

/**
 * Reads a one-time token out of the .eml the development transport writes. Every name
 * in `seen` is ignored, so only a message written after that snapshot can match.
 */
export async function readTokenFromMailbox(
  email: string,
  link: string,
  seen: ReadonlySet<string> = new Set(),
): Promise<string> {
  const pattern = new RegExp(`${link}\\?token=([A-Za-z0-9_-]+)`);
  const deadline = Date.now() + MAILBOX_TIMEOUT_MS;

  for (;;) {
    const token = await findToken(email, seen, pattern);

    if (token) {
      return token;
    }

    if (Date.now() >= deadline) {
      throw new Error(`No message carrying a ${link} token for ${email} in ${mailDir()}`);
    }

    await delay(MAILBOX_POLL_MS);
  }
}

function mailDir(): string {
  return resolve(process.env.MAIL_DEV_DIR ?? MAIL_DEV_DIR);
}

async function mailboxNames(): Promise<string[]> {
  try {
    return await readdir(mailDir());
  } catch {
    // The directory only exists once something has been sent.
    return [];
  }
}

async function findToken(
  email: string,
  seen: ReadonlySet<string>,
  pattern: RegExp,
): Promise<string | null> {
  const suffix = `-${email.replace(/[^a-z0-9]/gi, '_')}.eml`;
  const names = await mailboxNames();

  // Names are `${Date.now()}-${marker}.eml`, so sorting puts the newest match last.
  const candidates = names.filter((name) => !seen.has(name) && name.endsWith(suffix)).sort();

  for (const name of candidates.reverse()) {
    const raw = await readFile(join(mailDir(), name), 'utf8');
    // The transport writes quoted-printable, which splits the link across lines.
    const match = pattern.exec(raw.replace(/=\r?\n/g, '').replace(/=3D/g, '='));

    if (match) {
      return match[1];
    }
  }

  return null;
}
