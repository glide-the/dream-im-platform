// [Input] Primary-owned disposable PostgreSQL fixture and owned loopback app port.
// [Output] Focused public Provider usage/routing browser/API technical validation.
// [Pos] Harness only; reuses the existing isolated fixture lifecycle and installed Chrome.
// [Sync] 2026-10-07: explicitly disable the supported usage cache in the fake-upstream state-transition harness.
// [Sync] 2026-10-07: give one cold-compiled public business flow six minutes without changing Provider timeouts.
import { defineConfig } from "@playwright/test";
import shared from "../../playwright.config";
const baseURL = process.env.PLAYWRIGHT_BASE_URL;
if (!baseURL || !process.env.INK_ADMIN_E2E_DIST_DIR?.startsWith(".next-e2e-deadlock-")) throw new Error("Requires primary-owned isolated fixture");
const url = new URL(baseURL);
if (url.hostname !== "127.0.0.1" || url.port === "3000" || !url.port || !process.env.TEST_DATABASE_URL?.includes("ink_gateway_deadlock_test_")) throw new Error("Requires named disposable PostgreSQL and owned app port");
export default defineConfig({ ...shared, testDir: ".", testMatch: "provider-routing.spec.ts", timeout: 360_000,
  outputDir: "../../test-results/provider-routing",
  webServer: { command: `pnpm exec next dev --webpack -H 127.0.0.1 -p ${url.port}`, url: baseURL, reuseExistingServer: false, timeout: 180_000,
    env: { PROVIDER_USAGE_CACHE_TTL_SECONDS: "0" },
  },
});
