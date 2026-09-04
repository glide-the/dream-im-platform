// [Input] A runner-owned Admin base URL and optional installed Chromium channel.
// [Output] Single-worker Playwright configuration that never starts or reuses an ambient application server.
// [Pos] Configured managed-auth E2E config; lifecycle ownership remains in run-provider-managed-auth-e2e.mjs.
// [Sync] 2026-09-04: isolate the official-host Copilot success lane from the shared Playwright webServer.

import { defineConfig } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL) throw new Error("PLAYWRIGHT_BASE_URL is required for the managed-auth E2E lane");

const browserChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? "chrome";

export default defineConfig({
  testDir: "../tests/e2e",
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  workers: 1,
  reporter: [["line"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [{
    name: "chromium",
    use: {
      browserName: "chromium",
      channel: browserChannel,
      actionTimeout: 30_000,
      navigationTimeout: 30_000,
    },
  }],
});
