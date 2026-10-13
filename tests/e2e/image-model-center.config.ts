// [Input] Primary-owned disposable PostgreSQL fixture and owned loopback app port.
// [Output] Focused Image model-center public Admin/Gateway Playwright lane.
// [Pos] Harness only; starts one owned Next dev server and reuses installed Chrome.
// [Sync] 2026-10-09: isolate the Images technical acceptance from normal services and data.
// [Sync] 2026-10-10: keep the configuration/log/billing boundary screenshots separate from prior receipts.

import { defineConfig } from "@playwright/test";
import shared from "../../playwright.config";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || !process.env.INK_ADMIN_E2E_DIST_DIR?.startsWith(".next-e2e-deadlock-")) {
  throw new Error("Requires a primary-owned isolated fixture");
}
const url = new URL(baseURL);
if (url.hostname !== "127.0.0.1" || url.port === "3000" || !url.port
  || !process.env.TEST_DATABASE_URL?.includes("ink_gateway_deadlock_test_")) {
  throw new Error("Requires a named disposable PostgreSQL and owned app port");
}

export default defineConfig({
  ...shared,
  testDir: ".",
  testMatch: "image-model-center.spec.ts",
  timeout: 360_000,
  outputDir: "../../test-results/image-model-center-boundary",
  webServer: {
    command: `pnpm exec next dev --webpack -H 127.0.0.1 -p ${url.port}`,
    url: baseURL,
    env: {
      ...process.env,
      GATEWAY_SETTLEMENT_WORKER_SECRET: "image-e2e-settlement-worker-secret-2026",
      GATEWAY_UNKNOWN_USAGE_GRACE_SECONDS: "60",
    },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
