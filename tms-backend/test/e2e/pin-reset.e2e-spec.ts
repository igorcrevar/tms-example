import { INestApplication } from '@nestjs/common';
import { authenticator } from 'otplib';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';

import { AuthCookie } from '../../src/modules/auth/auth.constants';
import type { PinResetRequestSummary } from '../../src/modules/driver/driver.service';
import {
  CookieJar,
  bodyOf,
  createDriver,
  createStaffUser,
  createTestApp,
  deleteUsersByEmail,
  signInStaff,
} from './helpers';

const PIN = '482913';
const PASSWORD = 'correct horse battery staple';
const ADMIN = 'e2e-pin-admin@tms.local';
const DRIVER_EMAIL = 'e2e-pin-driver@tms.local';
const DRIVER_CODE = 'E2E-PIN-1';
const EMAILS = [ADMIN, DRIVER_EMAIL];

interface OpenRequestRow {
  id: string;
  resolvedAt: Date | null;
  resolvedById: string | null;
}

describe('PIN reset requests (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;
  let adminId: string;
  let adminJar: CookieJar;
  let driverId: string;

  const csrf = (jar: CookieJar) => jar.get(AuthCookie.StaffCsrf) ?? '';

  beforeAll(async () => {
    ({ app, dataSource } = await createTestApp());
    await deleteUsersByEmail(dataSource, EMAILS);

    const totpSecret = authenticator.generateSecret();
    ({ id: adminId } = await createStaffUser(dataSource, {
      email: ADMIN,
      password: PASSWORD,
      totpSecret,
    }));
    ({ id: driverId } = await createDriver(dataSource, {
      email: DRIVER_EMAIL,
      driverCode: DRIVER_CODE,
      pin: PIN,
    }));

    adminJar = await signInStaff(app, { email: ADMIN, password: PASSWORD, totpSecret });
  });

  afterAll(async () => {
    await deleteUsersByEmail(dataSource, EMAILS);
    await app?.close();
  });

  function requestRows(): Promise<OpenRequestRow[]> {
    return dataSource.query<OpenRequestRow[]>(
      'SELECT id, "resolvedAt", "resolvedById" FROM pin_reset_requests WHERE "driverId" = $1',
      [driverId],
    );
  }

  async function listRequests(jar: CookieJar): Promise<PinResetRequestSummary[]> {
    const response = await request(app.getHttpServer())
      .get('/api/staff/drivers/pin-reset-requests')
      .set('Cookie', jar.header())
      .expect(200);

    return bodyOf<PinResetRequestSummary[]>(response);
  }

  it('records one open request per driver and answers 204 whatever the code', async () => {
    await request(app.getHttpServer())
      .post('/api/driver/auth/forgot-pin')
      .send({ driverCode: DRIVER_CODE })
      .expect(204);

    // A repeat and an unknown code look identical from outside, and neither adds a row.
    await request(app.getHttpServer())
      .post('/api/driver/auth/forgot-pin')
      .send({ driverCode: DRIVER_CODE })
      .expect(204);
    await request(app.getHttpServer())
      .post('/api/driver/auth/forgot-pin')
      .send({ driverCode: 'NOPE-1' })
      .expect(204);

    const rows = await requestRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].resolvedAt).toBeNull();

    const [{ count }] = await dataSource.query<Array<{ count: string }>>(
      'SELECT count(*) FROM pin_reset_requests WHERE "resolvedAt" IS NULL',
    );
    expect(Number(count)).toBe(1);
  });

  it('lists the open request to staff who may read drivers', async () => {
    const open = await listRequests(adminJar);

    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      driverId,
      driverCode: DRIVER_CODE,
      firstName: 'Test',
      lastName: 'Driver',
    });
    expect(new Date(open[0].requestedAt).toISOString()).toBe(open[0].requestedAt);
  });

  it('refuses the listing without a staff session or the Driver permission', async () => {
    const driverJar = new CookieJar();
    driverJar.capture(
      await request(app.getHttpServer())
        .post('/api/driver/auth/login')
        .send({ driverCode: DRIVER_CODE, pin: PIN })
        .expect(200),
    );

    await request(app.getHttpServer())
      .get('/api/staff/drivers/pin-reset-requests')
      .set('Cookie', driverJar.header())
      .expect(401);

    // Grants are re-read per request, so withdrawing the role's Driver grant applies at once.
    const [grant] = await dataSource.query<Array<{ roleId: string; permissionId: string }>>(
      `SELECT rp."roleId", rp."permissionId" FROM role_permissions rp
         JOIN users u ON u."roleId" = rp."roleId"
         JOIN permissions p ON p.id = rp."permissionId"
        WHERE u.id = $1 AND p.subject = 'Driver'`,
      [adminId],
    );

    await dataSource.query(
      'DELETE FROM role_permissions WHERE "roleId" = $1 AND "permissionId" = $2',
      [grant.roleId, grant.permissionId],
    );

    try {
      await request(app.getHttpServer())
        .get('/api/staff/drivers/pin-reset-requests')
        .set('Cookie', adminJar.header())
        .expect(403);
    } finally {
      await dataSource.query(
        'INSERT INTO role_permissions ("roleId", "permissionId") VALUES ($1, $2)',
        [grant.roleId, grant.permissionId],
      );
    }
  });

  it('is resolved by setting a new PIN', async () => {
    await request(app.getHttpServer())
      .put(`/api/staff/drivers/${driverId}/pin`)
      .set('Cookie', adminJar.header())
      .set('x-csrf-token', csrf(adminJar))
      .send({ pin: '918273' })
      .expect(204);

    expect(await listRequests(adminJar)).toHaveLength(0);

    const [row] = await requestRows();
    expect(row.resolvedAt).toBeInstanceOf(Date);
    expect(row.resolvedById).toBe(adminId);

    // A driver whose PIN has just been set can ask again.
    await request(app.getHttpServer())
      .post('/api/driver/auth/forgot-pin')
      .send({ driverCode: DRIVER_CODE })
      .expect(204);
    expect(await listRequests(adminJar)).toHaveLength(1);
  });
});
