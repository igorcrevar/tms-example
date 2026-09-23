import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

import { SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SUPER_ADMIN_TOTP_SECRET } from './fixtures';
import { enterPin, submitCredentials, verifyCode } from './auth';
import { mailboxSnapshot, readInvitationToken } from './mailbox';

// Unique per run: deleted users keep their row, and driver codes and emails are unique.
const RUN = Date.now();
const FIRST_ADMIN_EMAIL = `e2e-onboarding-first-${RUN}@tms.local`;
const SECOND_ADMIN_EMAIL = `e2e-onboarding-second-${RUN}@tms.local`;
const SECOND_ADMIN_PASSWORD = `onboarded-admin-${RUN}`;
const DRIVER_CODE = `E2E-OB-${RUN}`;
const DRIVER_EMAIL = `e2e-onboarding-driver-${RUN}@tms.local`;
const DRIVER_PIN = '571902';

async function inviteAdmin(page: Page, email: string, lastName: string): Promise<void> {
  await page.getByRole('button', { name: 'Invite user' }).click();

  const dialog = page.getByRole('dialog', { name: 'Invite a user' });
  await dialog.getByLabel(/email/i).fill(email);
  await dialog.getByLabel(/first name/i).fill('Onboarded');
  await dialog.getByLabel(/last name/i).fill(lastName);
  await dialog.getByRole('button', { name: 'Send invitation' }).click();

  await expect(dialog).toBeHidden();
}

function rowFor(page: Page, email: string): Locator {
  return page.getByRole('row', { name: email });
}

test.describe('Admin onboarding', () => {
  test('invites, deletes, re-invites an admin who then adds a driver', async ({
    page,
    browser,
  }) => {
    test.slow();

    let firstToken = '';
    let secondToken = '';

    await test.step('super admin signs in and invites an admin', async () => {
      await submitCredentials(page, SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD);
      await verifyCode(page, SUPER_ADMIN_TOTP_SECRET);

      await page.goto('/admin/users');
      const seen = await mailboxSnapshot();
      await inviteAdmin(page, FIRST_ADMIN_EMAIL, 'First');

      await expect(rowFor(page, FIRST_ADMIN_EMAIL)).toContainText('INVITED');
      firstToken = await readInvitationToken(FIRST_ADMIN_EMAIL, seen);
    });

    await test.step('super admin deletes the invited admin', async () => {
      await rowFor(page, FIRST_ADMIN_EMAIL).getByRole('button', { name: 'Delete' }).click();

      const dialog = page.getByRole('dialog', { name: `Delete ${FIRST_ADMIN_EMAIL}?` });
      await dialog.getByRole('button', { name: 'Delete' }).click();

      await expect(rowFor(page, FIRST_ADMIN_EMAIL)).toHaveCount(0);
    });

    await test.step('the deleted admin cannot accept the invitation', async () => {
      const context = await browser.newContext();
      const invitee = await context.newPage();

      await invitee.goto(`/admin/accept-invite?token=${firstToken}`);
      await expect(invitee.getByRole('alert')).toContainText('This invitation link is not valid');
      await expect(invitee.getByLabel(/^password/i)).toBeHidden();

      await context.close();
    });

    await test.step('super admin invites another admin', async () => {
      const seen = await mailboxSnapshot();
      await inviteAdmin(page, SECOND_ADMIN_EMAIL, 'Second');

      await expect(rowFor(page, SECOND_ADMIN_EMAIL)).toContainText('INVITED');
      secondToken = await readInvitationToken(SECOND_ADMIN_EMAIL, seen);
    });

    const adminContext = await browser.newContext();
    const admin = await adminContext.newPage();

    await test.step('the new admin accepts the invitation', async () => {
      await admin.goto(`/admin/accept-invite?token=${secondToken}`);
      await expect(admin.getByText(SECOND_ADMIN_EMAIL)).toBeVisible();

      await admin.getByLabel(/^password/i).fill(SECOND_ADMIN_PASSWORD);
      await admin.getByLabel(/confirm password/i).fill(SECOND_ADMIN_PASSWORD);
      await admin.getByRole('button', { name: 'Activate account' }).click();

      await expect(admin.getByText('Your account is active')).toBeVisible();
    });

    await test.step('the new admin signs in and enrols an authenticator', async () => {
      // The first sign-in enrols; the secret is what an authenticator app would scan.
      const enrolment = admin.waitForResponse(
        (response) =>
          response.url().endsWith('/auth/2fa/enrol') && response.request().method() === 'POST',
      );
      await submitCredentials(admin, SECOND_ADMIN_EMAIL, SECOND_ADMIN_PASSWORD);
      const { secret } = (await (await enrolment).json()) as { secret: string };

      await expect(admin.getByRole('img', { name: /enrolment qr code/i })).toBeVisible();
      await verifyCode(admin, secret);
    });

    await test.step('the new admin adds a driver', async () => {
      await admin.goto('/admin/users');
      await admin.getByRole('button', { name: 'Add driver' }).click();

      const dialog = admin.getByRole('dialog', { name: 'Add a driver' });
      await dialog.getByLabel(/driver code/i).fill(DRIVER_CODE);
      await dialog.getByLabel(/first name/i).fill('Onboarded');
      await dialog.getByLabel(/last name/i).fill('Driver');
      await dialog.getByLabel(/email/i).fill(DRIVER_EMAIL);
      await dialog.getByLabel(/initial pin/i).fill(DRIVER_PIN);
      await dialog.getByRole('button', { name: 'Add driver' }).click();

      await expect(dialog).toBeHidden();
      const row = rowFor(admin, DRIVER_EMAIL);
      await expect(row).toContainText(`Onboarded Driver (${DRIVER_CODE})`);
      await expect(row).toContainText('ACTIVE');

      await adminContext.close();
    });

    await test.step('the new driver signs in', async () => {
      const context = await browser.newContext();
      const driver = await context.newPage();

      await driver.goto('/driver/login');
      await driver.getByLabel(/driver code/i).fill(DRIVER_CODE);
      await enterPin(driver, DRIVER_PIN);
      await driver.getByRole('button', { name: /sign in/i }).click();

      await expect(driver).toHaveURL(/\/driver$/);
      await expect(driver.getByRole('heading', { name: 'Today' })).toBeVisible();
      await expect(driver.getByText(DRIVER_CODE)).toBeVisible();

      await context.close();
    });
  });
});
