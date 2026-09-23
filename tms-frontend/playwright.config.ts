import { defineConfig, devices } from '@playwright/test';

const BACKEND_URL = 'http://localhost:3000';
const APP_URL = 'http://localhost:5173';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  // Serial: both trees share one backend and one set of seeded accounts.
  workers: 1,
  reporter: 'html',
  globalSetup: './tests/e2e/global-setup.ts',
  use: { baseURL: APP_URL, trace: 'on-first-retry' },
  projects: [
    {
      name: 'admin',
      testMatch: /admin-.*\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      // Drivers are on phones, so the driver tree is exercised on one.
      name: 'driver',
      testMatch: /driver-.*\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: [
    {
      // The per-IP login throttle would trip across specs; the seam is ignored in production.
      command: 'npm --prefix ../tms-backend run start:dev',
      env: { RATE_LIMIT_DISABLED: 'true' },
      url: `${BACKEND_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: 'ignore',
    },
    {
      command: 'npm run dev',
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
