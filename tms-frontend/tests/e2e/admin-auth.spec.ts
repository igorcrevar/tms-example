import { expect, test } from '@playwright/test';

import { signInStaff } from './auth';
import { STAFF_EMAIL, STAFF_PASSWORD, TOTP_SECRET, generateTotp } from './fixtures';

test.describe('Admin authentication', () => {
  test('sends an unauthenticated visitor to the login page', async ({ page }) => {
    await page.goto('/admin');

    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(page.getByRole('heading', { name: 'TMS Admin' })).toBeVisible();
  });

  test('rejects a wrong password without asking for a code', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel(/email/i).fill(STAFF_EMAIL);
    await page.getByLabel(/password/i).fill('not the right password');
    await page.getByRole('button', { name: /continue/i }).click();

    await expect(page.getByRole('alert')).toContainText(/invalid credentials/i);
    await expect(page.getByLabel(/authentication code/i)).toBeHidden();
  });

  test('asks for a code after a correct password, then signs in', async ({ page }) => {
    await page.goto('/admin/login');
    await page.getByLabel(/email/i).fill(STAFF_EMAIL);
    await page.getByLabel(/password/i).fill(STAFF_PASSWORD);
    await page.getByRole('button', { name: /continue/i }).click();

    await expect(page.getByLabel(/authentication code/i)).toBeVisible();

    await page.getByLabel(/authentication code/i).fill(generateTotp());
    await page.getByRole('button', { name: /verify/i }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('keeps the session token out of JavaScript', async ({ page, context }) => {
    await signInStaff(page, STAFF_EMAIL, STAFF_PASSWORD, TOTP_SECRET);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    const cookies = await context.cookies();
    const access = cookies.find((cookie) => cookie.name === 'tms_staff_at');
    const csrf = cookies.find((cookie) => cookie.name === 'tms_staff_csrf');

    expect(access?.httpOnly).toBe(true);
    expect(csrf?.httpOnly).toBe(false);

    const readable = await page.evaluate(() => document.cookie);
    expect(readable).not.toContain('tms_staff_at');

    const stored = await page.evaluate(() => JSON.stringify(window.localStorage));
    expect(stored).not.toContain('tms_staff');
  });

  test('signs out and protects the dashboard again', async ({ page }) => {
    await signInStaff(page, STAFF_EMAIL, STAFF_PASSWORD, TOTP_SECRET);
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

    await page.getByRole('button', { name: /sign out/i }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
