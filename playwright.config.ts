// [Input] Playwright base URL, CI mode, and an optional locally installed browser channel.
// [Output] Shared Admin browser-test configuration with a system-Chrome opt-in for local QA.
// [Pos] Root Playwright composition; test cases and application behavior remain environment-independent.
// [Sync] 2026-08-27: allow local E2E to reuse installed Chrome instead of downloading a duplicate revision.

import { defineConfig } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';
const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: [['html'], ['list']],
  
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  
  projects: [
    {
      name: 'chromium',
      use: { 
        browserName: 'chromium',
        ...(browserChannel ? { channel: browserChannel } : {}),
        actionTimeout: 30000,
        navigationTimeout: 30000,
      },
    },
  ],
  
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
