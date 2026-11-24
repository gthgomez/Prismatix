// playwright.config.ts
import { cpus } from 'node:os';
import { defineConfig, devices } from '@playwright/test';

const previewPort = Number(process.env.PLAYWRIGHT_PORT ?? 4173);

// R7: the default worker count (cores/2) oversubscribed a 16-thread Windows
// host: Chromium startup and the app bundle competed for CPU, producing
// intermittent 30s timeouts in different tests on each run (all passed in
// isolation, and the whole suite passed with 4 workers). Bound concurrency so
// the result is a function of the code, not of host load.
const maxWorkers = Math.max(1, Math.min(4, cpus().length - 1));

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  expect: {
    timeout: 5000,
  },
  fullyParallel: true,
  workers: maxWorkers,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    trace: 'on-first-retry',
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      use: { ...devices['Pixel 5'] },
    },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${previewPort}`,
    port: previewPort,
    reuseExistingServer: !process.env.CI && !process.env.PLAYWRIGHT_FORCE_WEB_SERVER,
    timeout: 120000,
  },
});
