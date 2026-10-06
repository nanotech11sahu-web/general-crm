import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Use a pre-installed Chromium when present (CI-less sandboxes); otherwise Playwright's own download.
const chromium = process.env.CHROMIUM_PATH ?? (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  webServer: { command: 'npx next start -p 3400', url: 'http://127.0.0.1:3400/login', reuseExistingServer: false, timeout: 60_000, env: { API_URL: 'http://127.0.0.1:3300' } },
  use: {
    baseURL: 'http://127.0.0.1:3400',
    viewport: { width: 390, height: 844 }, // a mid-range phone
    launchOptions: { executablePath: chromium, args: ['--no-sandbox'] },
    serviceWorkers: 'allow',
  },
});
