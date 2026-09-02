// [Input] Isolated Admin session plus mocked production-shaped Marketplace list/detail/run/sync API responses.
// [Output] Browser evidence for durable sync progress, actionable failure feedback, retry access, and narrow-screen containment.
// [Pos] Focused ClaudePlugin Marketplace operator interaction regression.
// [Sync] 2026-09-02: cover persisted running state and explicit remote-timeout recovery.

import { expect, test, type Page } from "@playwright/test";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const marketplaceId = "cpm_marketplace_feedback_e2e";
const now = "2026-09-02T10:20:05.000Z";

async function bootstrapAdmin(page: Page) {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByLabel("显示名称").fill("Marketplace QA");
  await page.getByLabel("管理员邮箱").fill("marketplace-feedback@example.test");
  await page.getByLabel("初始密码").fill("Marketplace-feedback-admin-2026!");
  await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
  await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test("shows recoverable remote synchronization progress and timeout feedback", async ({ page }, testInfo) => {
  test.skip(!bootstrapToken, "Run only with an owned isolated PostgreSQL database");
  test.setTimeout(120_000);

  let phase: "idle" | "running" | "failed" = "idle";
  let finishSync: (() => void) | null = null;

  await page.route("http://unpkg.com/react-grab/dist/index.global.js", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
  });
  await page.route("**/api/admin/claude-plugin-marketplaces**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const failed = phase === "failed";
    const summary = {
      id: marketplaceId,
      slug: "mcp-apps",
      display_name: "MCP Apps",
      remote_url: "https://github.com/modelcontextprotocol/ext-apps",
      default_ref: null,
      marketplace_name: failed ? null : "mcp-apps",
      status: failed ? "error" : "active",
      latest_revision_id: null,
      latest_commit_sha: null,
      latest_validation_status: null,
      latest_synced_at: null,
      entry_count: 0,
      approved_count: 0,
      last_sync_error_code: failed
        ? "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_TIMEOUT"
        : null,
      last_sync_error_summary: failed
        ? "远程 Marketplace 在同步时限内未响应"
        : null,
    };

    if (request.method() === "POST" && path.endsWith("/sync")) {
      phase = "running";
      await new Promise<void>((resolve) => {
        finishSync = () => {
          phase = "failed";
          resolve();
        };
      });
      await route.fulfill({
        status: 504,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_TIMEOUT",
            message: "远程 Marketplace 在同步时限内未响应",
          },
        }),
      });
      return;
    }
    if (path.endsWith("/runs")) {
      const status = phase === "running" ? "running" : failed ? "failed" : "succeeded";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          data: [{
            id: "cpms_feedback_e2e",
            status,
            requested_ref: null,
            resolved_commit_sha: null,
            error_code: failed ? "CLAUDE_PLUGIN_MARKETPLACE_REMOTE_TIMEOUT" : null,
            error_summary: failed ? "远程 Marketplace 在同步时限内未响应" : null,
            created_at: now,
            started_at: now,
            finished_at: failed ? "2026-09-02T10:22:05.000Z" : null,
          }],
        }),
      });
      return;
    }
    if (path === `/api/admin/claude-plugin-marketplaces/${marketplaceId}`) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ data: { ...summary, revisions: [], policies: [] } }),
      });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ data: [summary] }),
    });
  });

  await bootstrapAdmin(page);
  await page.goto("/admin/resources/claude-plugin-marketplaces");
  await expect(page.getByRole("heading", { name: "MCP Apps", exact: true })).toBeVisible();

  phase = "running";
  await page.reload();
  const persistedProgress = page.getByRole("status").filter({
    hasText: "正在读取并校验远程 Marketplace",
  });
  await expect(persistedProgress).toBeVisible();
  await expect(persistedProgress).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "同步中…" })).toBeDisabled();

  phase = "idle";
  await page.reload();
  await page.getByRole("button", { name: "同步远程", exact: true }).click();
  await expect(page.getByText("正在读取并校验远程 Marketplace", { exact: true })).toBeVisible();
  await expect.poll(() => Boolean(finishSync)).toBe(true);
  finishSync?.();

  await expect(page.getByText("同步失败", { exact: true })).toBeVisible();
  await expect(page.getByText("最近一次同步失败", { exact: true })).toBeVisible();
  await expect(page.getByText("CLAUDE_PLUGIN_MARKETPLACE_REMOTE_TIMEOUT", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "重新同步", exact: true })).toBeEnabled();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(async () => page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )).toBeLessThanOrEqual(1);
  await page.screenshot({ path: testInfo.outputPath("marketplace-sync-timeout-mobile.png"), fullPage: true });
});
