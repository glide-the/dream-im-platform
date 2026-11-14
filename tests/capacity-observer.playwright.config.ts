// [Input] Bounded native HTTP observer harness with Playwright's API client.
// [Output] Focused transport-lifecycle validation without starting Admin, a database or a browser.
// [Pos] Observation adapter E2E only; never a real AI/capacity acceptance result.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "capacity-observer.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 15_000,
});
