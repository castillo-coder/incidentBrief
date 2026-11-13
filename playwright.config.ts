import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';

process.env.E2E_PASSWORD ??= randomBytes(20).toString('hex');
export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm run build && npx tsx tests/browser-server.ts',
    url: 'http://127.0.0.1:4173/healthz',
    reuseExistingServer: false,
    timeout: 90000,
  },
});
