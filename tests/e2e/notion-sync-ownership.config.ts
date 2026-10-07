// [Input] Primary-owned isolated production-route HTTP harness fixture.
// [Output] Bounded API-request Playwright lane without starting Next, a browser, or normal services.
// [Pos] Technical verification config; database/migrations are prepared by the primary agent.
// [Sync] 2026-10-07: verify sync execution through real DTO/Route Handlers and original receipt GET.
import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "notion-sync-ownership.spec.ts", workers: 1,
  retries: 0, timeout: 30_000, reporter: [["list"]], outputDir: "../../.test-artifacts/notion-sync-ownership" });
