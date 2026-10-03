// [Input] A primary-owned isolated fixture, explicit loopback URL and system Chrome.
// [Output] Focused concurrent Gateway public-route E2E on an owned Next process and isolated PostgreSQL.
// [Pos] Harness composition only; no production state machine or database behavior is copied.
// [Sync] 2026-10-02: launch Next directly because the fixture already owns PostgreSQL; never reuse port 3000.
import { defineConfig } from "@playwright/test";
import shared from "../../playwright.config";

const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || !process.env.INK_ADMIN_E2E_DIST_DIR?.startsWith(".next-e2e-deadlock-")) {
  throw new Error("Gateway deadlock E2E requires the named owned fixture");
}
const url = new URL(baseURL);
if (url.hostname !== "127.0.0.1" || url.port === "3000" || !url.port) {
  throw new Error("Gateway deadlock E2E must use its owned loopback port");
}
export default defineConfig({
  ...shared, testDir: ".", testMatch: "gateway-deadlock.spec.ts", timeout: 180_000,
  webServer: {
    command: `pnpm exec next dev --webpack -H 127.0.0.1 -p ${url.port}`,
    url: baseURL, reuseExistingServer: false, timeout: 180_000,
  },
});
