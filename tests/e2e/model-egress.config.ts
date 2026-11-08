// [Input] Installed system Chrome and the component spec's owned loopback server.
// [Output] Focused Provider network-switch browser validation without application/database startup.
// [Pos] Harness only; production component and DTO are reused unchanged.
import { defineConfig } from "@playwright/test";
import shared from "../../playwright.config";
export default defineConfig({ ...shared, testDir: ".", testMatch: "model-egress.spec.ts", webServer: undefined,
  outputDir: "../../test-results/model-egress", workers: 1,
  projects: [{ name: "chrome", use: { browserName: "chromium", channel: "chrome" } }],
});
