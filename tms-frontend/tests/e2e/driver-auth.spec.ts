import { expect, test } from '@playwright/test';

import { enterPin } from './auth';
import { DRIVER_CODE, DRIVER_PIN } from './fixtures';

test.describe('Driver authentication', () => {
  test('sends an unauthenticated driver to the PIN screen', async ({ page }) => {
    await page.goto('/driver');

    await expect(page).toHaveURL(/\/driver\/login$/);
    await expect(page.getByRole('heading', { name: /driver sign in/i })).toBeVisible();
  });

  test('enables sign-in only once six digits are entered', async ({ page }) => {
    await page.goto('/driver/login');
    await page.getByLabel(/driver code/i).fill(DRIVER_CODE);

    const submit = page.getByRole('button', { name: /sign in/i });
    await expect(submit).toBeDisabled();

    await enterPin(page, DRIVER_PIN.slice(0, 5));
    await expect(submit).toBeDisabled();

    await enterPin(page, DRIVER_PIN.slice(5));
    await expect(submit).toBeEnabled();
  });

  test('rejects a wrong PIN and clears the pad', async ({ page }) => {
    await page.goto('/driver/login');
    await page.getByLabel(/driver code/i).fill(DRIVER_CODE);
    await enterPin(page, '000000');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('alert')).toContainText(/did not match/i);
    await expect(page.getByRole('button', { name: /sign in/i })).toBeDisabled();
  });

  test('signs in with the PIN and shows the day view', async ({ page, context }) => {
    await page.goto('/driver/login');
    await page.getByLabel(/driver code/i).fill(DRIVER_CODE);
    await enterPin(page, DRIVER_PIN);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/driver$/);
    await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
    await expect(page.getByText(DRIVER_CODE)).toBeVisible();

    const cookies = await context.cookies();
    expect(cookies.find((cookie) => cookie.name === 'tms_driver_at')?.httpOnly).toBe(true);
    // The driver app must never receive a staff token.
    expect(cookies.find((cookie) => cookie.name === 'tms_staff_at')).toBeUndefined();
  });
});
