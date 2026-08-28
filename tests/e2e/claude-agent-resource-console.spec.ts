// [Input] Owned isolated PostgreSQL, visible Admin bootstrap, and the Claude Agent resource console.
// [Output] Browser proof for resources/global effort plus real AIModelRegistry model Runtime controls.
// [Pos] Focused provider-free Admin resource-policy journey; it never controls or restarts Dream.
// [Sync] 2026-08-28: verify nullable effort desired/effective and model compact/context save through real UI entry points.

import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const databaseUrl = process.env.TEST_DATABASE_URL;
type PolicyValues = {
  maxConcurrentRuns: number;
  runMemoryBudgetMib: number;
  memoryReserveMib: number;
  retryAfterSeconds: number;
  claudeCodeEffortLevel: "low" | "medium" | "high" | "xhigh" | "max" | null;
};
const INITIAL_POLICY: PolicyValues = {
  maxConcurrentRuns: 1,
  runMemoryBudgetMib: 416,
  memoryReserveMib: 128,
  retryAfterSeconds: 60,
  claudeCodeEffortLevel: null,
};
const LARGE_POLICY: PolicyValues = {
  maxConcurrentRuns: 1_000_000,
  runMemoryBudgetMib: 9_000,
  memoryReserveMib: 5_000,
  retryAfterSeconds: 4_000,
  claudeCodeEffortLevel: "high",
};

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

function resourceSnapshot(policy: PolicyValues, revision: number | null) {
  const now = new Date().toISOString();
  const requiredHeadroomBytes = (policy.runMemoryBudgetMib + policy.memoryReserveMib) * 1_048_576;
  const values = {
    max_concurrent_runs: policy.maxConcurrentRuns,
    run_memory_budget_mib: policy.runMemoryBudgetMib,
    memory_reserve_mib: policy.memoryReserveMib,
    retry_after_seconds: policy.retryAfterSeconds,
    required_headroom_bytes: requiredHeadroomBytes,
  };
  return {
    schema_version: 1,
    backend_status: "ok",
    scope: { active_runs: "process", counters: "process_lifetime", reset_on_restart: true },
    config: {
      defaults: {
        max_concurrent_runs: 1,
        run_memory_budget_mib: 512,
        memory_reserve_mib: 128,
        retry_after_seconds: 60,
        required_headroom_bytes: 671_088_640,
      },
      effective: values,
      claude_code: { effort_level: policy.claudeCodeEffortLevel },
      effective_version: `e2e-effective-${policy.maxConcurrentRuns}-${revision ?? "none"}`,
      loaded_at: now,
      policy_status: revision === null ? "not_configured" : "applied",
      policy_revision: revision,
      policy_updated_at: revision === null ? null : now,
    },
    turns: { started_total: 3, completed_total: 3, failed_total: 0, cancelled_total: 0 },
    admission: {
      active_runs: 0,
      max_concurrent_runs: policy.maxConcurrentRuns,
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
      required_headroom_bytes: requiredHeadroomBytes,
      events: { low: null, high: null, max: null, oom: null, oom_kill: null },
    },
    sample: { status: "ok", sampled_at: now, stale: false, error_code: null },
    pipeline: { queue_dropped_total: 0, write_errors_total: 0, last_write_error_at: null },
  };
}

test.describe("Claude Agent resource policy console", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!bootstrapToken || !databaseUrl, "Run only with an owned isolated PostgreSQL database");

  test("saves four uncapped values, resaves existing desired, and refreshes effective", async ({ page, context, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    await page.route("http://unpkg.com/react-grab/dist/index.global.js", (route) =>
      route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
    );

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    await expect(
      page.getByRole("heading", { name: /设置首位管理员|登录运营控制台/ }),
    ).toBeVisible();
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
        [JSON.stringify(resourceSnapshot(INITIAL_POLICY, null))],
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
      let getRequests = 0;
      let dialogCount = 0;
      const patchPayloads: Array<Record<string, unknown>> = [];
      page.on("dialog", async (dialog) => {
        dialogCount += 1;
        await dialog.dismiss();
      });
      page.on("request", (request) => {
        if (!request.url().endsWith("/api/admin/claude-agent-resources")) return;
        if (request.method() === "PATCH") {
          patchRequests += 1;
          patchPayloads.push(request.postDataJSON() as Record<string, unknown>);
        } else if (request.method() === "GET") {
          getRequests += 1;
        }
      });
      await expect(concurrency).not.toHaveAttribute("max");
      for (const invalid of ["0", "-1", "1.5"]) {
        await concurrency.fill(invalid);
        await expect(page.getByText("请输入有效的正整数", { exact: true })).toBeVisible();
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
      await concurrency.fill(String(LARGE_POLICY.maxConcurrentRuns));
      const runBudget = page.getByLabel("单次 Agent 内存预算（MiB）");
      const reserve = page.getByLabel("系统保留内存（MiB）");
      const retry = page.getByLabel("重试等待（秒）");
      const effort = page.getByLabel("Claude Code 推理强度");
      for (const input of [runBudget, reserve, retry]) await expect(input).not.toHaveAttribute("max");
      await runBudget.fill(String(LARGE_POLICY.runMemoryBudgetMib));
      await reserve.fill(String(LARGE_POLICY.memoryReserveMib));
      await retry.fill(String(LARGE_POLICY.retryAfterSeconds));
      await effort.selectOption(LARGE_POLICY.claudeCodeEffortLevel!);
      await expect(concurrency).toHaveValue(String(LARGE_POLICY.maxConcurrentRuns));
      await expect(page.getByText("仅限整数", { exact: false })).toHaveCount(0);
      await expect(page.getByText("无产品上限", { exact: false })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "撤销修改" })).toBeVisible();
      const save = page.getByRole("button", { name: "保存期望配置" });
      await expect(save).toBeEnabled();
      await save.click();
      await expect.poll(() => patchRequests).toBe(1);
      await expect.poll(() => getRequests, { timeout: 3_000 }).toBeGreaterThan(0);
      expect(dialogCount).toBe(0);
      expect(patchPayloads[0]).toEqual({ ...LARGE_POLICY, expectedRevision: null });

      const pendingNotice = page.getByRole("status").filter({ hasText: "期望配置已保存" });
      await expect(pendingNotice).toContainText("正在等待应用");
      await expect(pendingNotice).toContainText("desired revision 1");
      await expect(pendingNotice).not.toContainText("PostgreSQL");
      await expect(page.getByText("保存后将自动应用，无需重启。", { exact: true })).toBeVisible();
      await expect(page.getByText("PostgreSQL", { exact: false })).toHaveCount(0);
      await expect(concurrency).toHaveValue(String(LARGE_POLICY.maxConcurrentRuns));
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
            values: LARGE_POLICY,
          },
          application: { status: "pending", applied: false },
        },
      });

      await client.query(
        `UPDATE claude_agent_resource_snapshots
            SET heartbeat_at = NOW(), sampled_at = NOW(), snapshot = $2::jsonb, updated_at = NOW()
          WHERE instance_id = $1`,
        ["resource-policy-e2e", JSON.stringify(resourceSnapshot(LARGE_POLICY, 1))],
      );

      await expect(page.getByText("Dream 已加载 desired revision 1", { exact: false })).toBeVisible({ timeout: 15_000 });
      await expect(concurrencyRow.locator("td").nth(2)).toHaveText(String(LARGE_POLICY.maxConcurrentRuns));
      await expect(page.getByText(`0 / ${LARGE_POLICY.maxConcurrentRuns}`, { exact: true })).toBeVisible();
      await expect(page.locator("p").filter({ hasText: /^high$/ })).toBeVisible();

      const secondConcurrency = LARGE_POLICY.maxConcurrentRuns + 1;
      const getRequestsBeforeSecondSave = getRequests;
      await concurrency.fill(String(secondConcurrency));
      await page.getByRole("button", { name: "保存期望配置" }).click();
      await expect.poll(() => patchRequests).toBe(2);
      await expect.poll(() => getRequests).toBeGreaterThan(getRequestsBeforeSecondSave);
      expect(patchPayloads[1]).toEqual({
        ...LARGE_POLICY,
        maxConcurrentRuns: secondConcurrency,
        expectedRevision: 1,
      });
      expect(patchPayloads[1]).not.toHaveProperty("schemaVersion");
      expect(patchPayloads[1]).not.toHaveProperty("revision");
      await expect(pendingNotice).toContainText("desired revision 2");
      expect(dialogCount).toBe(0);

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

      await client.query(
        `INSERT INTO ai_providers (
           id, code, name, protocol, base_url, status, timeout_ms, max_retries, config
         ) VALUES ($1, $2, $3, 'anthropic', 'https://example.invalid', 'disabled', 120000, 1, '{}'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        ["provider-runtime-e2e", "provider-runtime-e2e", "Runtime E2E Provider"],
      );

      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.goto(
        "/admin/models/models/new?providerId=provider-runtime-e2e&upstreamModel=runtime-e2e",
      );
      await expect(page.getByRole("heading", { name: "添加模型", exact: true })).toBeVisible();
      await expect(page.getByRole("group", { name: "Claude Code Runtime", exact: true })).toBeVisible();
      const compactWindow = page.getByLabel("自动压缩窗口");
      const maxContextTokens = page.getByLabel("最大上下文 Token");
      await expect(compactWindow).toHaveValue("");
      await expect(maxContextTokens).toHaveValue("");
      await compactWindow.fill("262144");
      await maxContextTokens.fill("262144");
      await page.getByRole("button", { name: "添加模型", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/models\/models\?saved=/);

      const createdModel = await client.query<{
        id: string;
        claude_code_auto_compact_window: number | null;
        claude_code_max_context_tokens: number | null;
      }>(
        `SELECT id, claude_code_auto_compact_window, claude_code_max_context_tokens
           FROM ai_models
          WHERE code = 'runtime-e2e'`,
      );
      expect(createdModel.rows).toHaveLength(1);
      expect(createdModel.rows[0]).toMatchObject({
        claude_code_auto_compact_window: 262144,
        claude_code_max_context_tokens: 262144,
      });

      await page.goto(`/admin/models/models/${createdModel.rows[0].id}/edit`);
      await expect(page.getByRole("heading", { name: "模型设置", exact: true })).toBeVisible();
      await expect(page.getByLabel("自动压缩窗口")).toHaveValue("262144");
      await page.getByLabel("自动压缩窗口").fill("");
      await page.getByRole("button", { name: "保存模型设置", exact: true }).click();
      await expect(page).toHaveURL(/\/admin\/models\/models\?saved=/);
      const clearedModel = await client.query<{
        claude_code_auto_compact_window: number | null;
        claude_code_max_context_tokens: number | null;
      }>(
        `SELECT claude_code_auto_compact_window, claude_code_max_context_tokens
           FROM ai_models
          WHERE id = $1`,
        [createdModel.rows[0].id],
      );
      expect(clearedModel.rows[0]).toEqual({
        claude_code_auto_compact_window: null,
        claude_code_max_context_tokens: 262144,
      });
    } finally {
      await client.end();
    }

    expect(diagnostics).toEqual([]);
  });
});
