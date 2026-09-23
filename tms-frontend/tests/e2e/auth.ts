import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

import { generateTotp } from './fixtures';

export async function submitCredentials(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/admin/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /continue/i }).click();
}

export async function verifyCode(page: Page, secret: string): Promise<void> {
  await page.getByLabel(/authentication code/i).fill(generateTotp(secret));
  await page.getByRole('button', { name: /verify/i }).click();

  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

export async function signInStaff(page: Page, email: string, password: string, secret: string): Promise<void> {
  await submitCredentials(page, email, password);
  await verifyCode(page, secret);
}

export async function enterPin(page: Page, pin: string): Promise<void> {
  for (const digit of pin) {
    await page.getByRole('button', { name: `Digit ${digit}` }).click();
  }
}
