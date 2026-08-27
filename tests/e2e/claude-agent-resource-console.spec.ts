// [Input] Owned isolated PostgreSQL, visible Admin bootstrap, and the Claude Agent resource console.
// [Output] Browser proof for large positive concurrency, invalid no-PATCH, immediate pending, and applied refresh.
// [Pos] Focused provider-free Admin resource-policy journey; it never controls or restarts Dream.
// [Sync] 2026-08-27: remove the product concurrency max and native confirm while preserving validation and PG handoff.

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const databaseUrl = process.env.TEST_DATABASE_URL;
const LARGE_CONCURRENCY = 1_000_000;

function collectDiagnostics(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "failed";
    if (reason !== "net::ERR_ABORTED") diagnostics.push(`${reason}: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) diagnostics.push(`http ${response.status()}: ${response.url()}`);
  });
  return diagnostics;
}

function resourceSnapshot(maxConcurrentRuns: number, revision: number | null) {
  const now = new Date().toISOString();
  const values = {
    max_concurrent_runs: maxConcurrentRuns,
    run_memory_budget_mib: 416,
    memory_reserve_mib: 128,
    retry_after_seconds: 60,
    required_headroom_bytes: 570_425_344,
  };
  return {
    schema_version: 1,
    backend_status: "ok",
    scope: { active_runs: "process", counters: "process_lifetime", reset_on_restart: true },
    config: {
      defaults: { ...values, max_concurrent_runs: 1, run_memory_budget_mib: 512, required_headroom_bytes: 671_088_640 },
      effective: values,
      effective_version: `e2e-effective-${maxConcurrentRuns}-${revision ?? "none"}`,
      loaded_at: now,
      policy_status: revision === null ? "not_configured" : "applied",
      policy_revision: revision,
      policy_updated_at: revision === null ? null : now,
    },
    turns: { started_total: 3, completed_total: 3, failed_total: 0, cancelled_total: 0 },
    admission: {
      active_runs: 0,
      max_concurrent_runs: maxConcurrentRuns,
      granted_total: 3,
      capacity_denials_total: 1,
      memory_pressure_denials_total: 0,
      last_denial_type: "capacity",
      last_denial_at: now,
      can_start_new_agent: true,
    },
    claude_processes: { available: false, count: null, total_rss_bytes: null },
    memory: {
      host_available_bytes: 4_294_967_296,
      cgroup_current_bytes: null,
      cgroup_max_bytes: null,
      cgroup_raw_headroom_bytes: null,
      inactive_file_bytes: null,
      slab_reclaimable_bytes: null,
      cgroup_reclaimable_bytes: null,
      cgroup_effective_headroom_bytes: null,
      required_headroom_bytes: 570_425_344,
      events: { low: null, high: null, max: null, oom: null, oom_kill: null },
    },
    sample: { status: "ok", sampled_at: now, stale: false, error_code: null },
    pipeline: { queue_dropped_total: 0, write_errors_total: 0, last_write_error_at: null },
  };
}

test.describe("Claude Agent resource policy console", () => {
  test.describe.configure({ timeout: 90_000 });
  test.skip(!bootstrapToken || !databaseUrl, "Run only with an owned isolated PostgreSQL database");

  test("saves large uncapped concurrency, stays pending, then refreshes applied effective values", async ({ page, context, baseURL }, testInfo) => {
    test.setTimeout(90_000);
    await page.route("http://unpkg.com/react-grab/dist/index.global.js", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
    );

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    const email = "resource-policy-qa@example.test";
    const password = "Resource-policy-QA-2026!";
    if ((await page.getByLabel("显示名称").count()) === 1) {
      await page.getByLabel("显示名称").fill("Resource Policy QA");
      await page.getByLabel("管理员邮箱").fill(email);
      await page.getByLabel("初始密码").fill(password);
      await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
      await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
    } else {
      await page.getByLabel("管理员邮箱").fill(email);
      await page.getByLabel("密码", { exact: true }).fill(password);
      await page.getByRole("button", { name: "登录控制台" }).click();
    }
    await expect(page).toHaveURL(/\/admin$/);
    const diagnostics = collectDiagnostics(page);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
      await client.query(
        `INSERT INTO claude_agent_resource_snapshots (
           instance_id, process_started_at, heartbeat_at, sampled_at, snapshot
         ) VALUES ('resource-policy-e2e', NOW() - interval '1 minute', NOW(), NOW(), $1::jsonb)
         ON CONFLICT (instance_id) DO UPDATE SET
           process_started_at = EXCLUDED.process_started_at,
           heartbeat_at = EXCLUDED.heartbeat_at,
           sampled_at = EXCLUDED.sampled_at,
           snapshot = EXCLUDED.snapshot,
           updated_at = NOW()`,
        [JSON.stringify(resourceSnapshot(1, null))],
      );

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto("/admin/system/claude-agent-resources");
      await expect(page.getByRole("heading", { name: "Claude Agent 资源", exact: true })).toBeVisible();

      const saveDisabled = page.getByRole("button", { name: "修改后可保存" });
      await expect(saveDisabled).toBeVisible();
      await expect(saveDisabled).toBeDisabled();
      const colors = await saveDisabled.evaluate((element) => {
        const style = getComputedStyle(element);
        return { color: style.color, background: style.backgroundColor };
      });
      expect(colors.color).not.toBe(colors.background);

      const concurrency = page.getByLabel("最大并发 Agent turn");
      await expect(concurrency).toHaveValue("1");
      let patchRequests = 0;
      page.on("request", (request) => {
        if (request.method() === "PATCH" && request.url().endsWith("/api/admin/claude-agent-resources")) {
          patchRequests += 1;
        }
      });
      await expect(concurrency).not.toHaveAttribute("max");
      for (const invalid of ["0", "-1", "1.5"]) {
        await concurrency.fill(invalid);
        await expect(page.getByText("请输入不小于 1 的整数", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "请检查输入范围" })).toBeDisabled();
        expect(patchRequests).toBe(0);
      }

      await concurrency.fill("1");
      await concurrency.press("ArrowUp");
      await expect(concurrency).toHaveValue("2");
      await concurrency.press("ArrowDown");
      await expect(concurrency).toHaveValue("1");
      await concurrency.press("ArrowUp");
      await expect(concurrency).toHaveValue("2");
      await concurrency.fill(String(LARGE_CONCURRENCY));
      await expect(concurrency).toHaveValue(String(LARGE_CONCURRENCY));
      await expect(page.getByRole("button", { name: "撤销修改" })).toBeVisible();
      const save = page.getByRole("button", { name: "保存期望配置" });
      await expect(save).toBeEnabled();
      await save.click();
      await expect.poll(() => patchRequests).toBe(1);

      const pendingNotice = page.getByRole("status").filter({ hasText: "期望配置已保存" });
      await expect(pendingNotice).toContainText("等待 Dream 下次定时读取后生效");
      await expect(pendingNotice).toContainText("无需重启");
      await expect(pendingNotice).toContainText("desired revision 1");
      await expect(concurrency).toHaveValue(String(LARGE_CONCURRENCY));
      await expect(page.getByRole("button", { name: "修改后可保存" })).toBeDisabled();
      const concurrencyRow = page.getByRole("row").filter({ hasText: "最大并发 Agent turn" });
      await expect(concurrencyRow.locator("td").nth(2)).toHaveText("1");

      const origin = new URL(baseURL!).origin;
      const api = await context.request.get(`${baseURL}/api/admin/claude-agent-resources`, {
        headers: { origin },
      });
      expect(api.status()).toBe(200);
      await expect(api.json()).resolves.toMatchObject({
        data: {
          desired: {
            status: "valid",
            revision: 1,
            values: { maxConcurrentRuns: LARGE_CONCURRENCY },
          },
          application: { status: "pending", applied: false },
        },
      });

      await client.query(
        `UPDATE claude_agent_resource_snapshots
            SET heartbeat_at = NOW(), sampled_at = NOW(), snapshot = $2::jsonb, updated_at = NOW()
          WHERE instance_id = $1`,
        ["resource-policy-e2e", JSON.stringify(resourceSnapshot(LARGE_CONCURRENCY, 1))],
      );

      await expect(page.getByText("Dream 已加载 desired revision 1", { exact: false })).toBeVisible({ timeout: 15_000 });
      await expect(concurrencyRow.locator("td").nth(2)).toHaveText(String(LARGE_CONCURRENCY));
      await expect(page.getByText(`0 / ${LARGE_CONCURRENCY}`, { exact: true })).toBeVisible();

      const finalButton = page.getByRole("button", { name: "修改后可保存" });
      await finalButton.scrollIntoViewIfNeeded();
      const box = await finalButton.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(1000);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      await page.screenshot({ path: testInfo.outputPath("claude-agent-resource-policy-desktop.png"), fullPage: true });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.reload();
      await expect(page.getByRole("heading", { name: "Claude Agent 资源", exact: true })).toBeVisible();
      const mobileButton = page.getByRole("button", { name: "修改后可保存" });
      await mobileButton.scrollIntoViewIfNeeded();
      await expect(mobileButton).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    } finally {
      await client.end();
    }

    expect(diagnostics).toEqual([]);
  });
});
