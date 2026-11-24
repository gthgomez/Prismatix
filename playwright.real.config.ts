// Playwright config for REAL-backend qualification (no route mocks).
//
// The web server serves a build produced with the local Supabase VITE_* values
// (see scripts/qualification/run-real-e2e.mjs). Point PLAYWRIGHT_PORT at a
// dedicated port so a synthetic preview server never serves this suite.

import { defineConfig, devices } from '@playwright/test';

const previewPort = Number(process.env.PLAYWRIGHT_PORT ?? 4174);

export default defineConfig({
  testDir: './tests/e2e-real',
  timeout: 60000,
  expect: { timeout: 10000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://127.0.0.1:${previewPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // Journeys set their own viewport (desktop and 390x844 mobile), so a single
    // project avoids running the same real turn twice against the shared stack.
    { name: 'real', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${previewPort}`,
    port: previewPort,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
