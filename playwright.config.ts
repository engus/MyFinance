import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: externalBaseUrl ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: externalBaseUrl
    ? undefined
    : [
        {
          command: 'npm run db:test:deploy && exec node --import tsx apps/api/src/server.ts',
          url: 'http://127.0.0.1:3001/health',
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            DATABASE_URL:
              process.env.DATABASE_URL ??
              'postgresql://myfinance:myfinance@127.0.0.1:5433/myfinance_test',
            NODE_ENV: 'test',
          },
        },
        {
          command: 'exec apps/web/node_modules/.bin/vite apps/web --host 127.0.0.1',
          url: 'http://127.0.0.1:5173/login',
          reuseExistingServer: false,
          timeout: 120_000,
        },
      ],
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
  ],
});
