import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const superEmail = "story-admin@example.test";
const superPassword = "Story-super-admin-2026!";
const auditorEmail = "story-auditor@example.test";
const auditorPassword = "Story-auditor-pass-2026!";

function collectDiagnostics(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    const text = message.text();
    if (
      message.type() === "error" &&
      !text.includes("server responded with a status of 401") &&
      !text.includes("server responded with a status of 404") &&
      !text.includes("server responded with a status of 409") &&
      !text.includes("server responded with a status of 500") &&
      !text.includes("server responded with a status of 503")
    ) {
      diagnostics.push(`console: ${text}`);
    }
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "failed";
    if (reason !== "net::ERR_ABORTED") diagnostics.push(`${reason}: ${request.url()}`);
  });
  return diagnostics;
}

async function noDocumentOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

test.describe("Dream Story data visibility with isolated PostgreSQL", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(
    !bootstrapToken || !process.env.TEST_DATABASE_URL,
    "Requires an owned isolated PostgreSQL and bootstrap token",
  );

  test("keeps canonical Workspace and Story data visible across API, filters, errors and both viewports", async ({
    context,
    page,
    request,
    baseURL,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.route("http://unpkg.com/react-grab/dist/index.global.js", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    });
    const diagnostics = collectDiagnostics(page);
    const origin = new URL(baseURL!).origin;

    expect((await request.get(`${baseURL}/api/admin/story-workspaces`)).status()).toBe(401);
    expect((await request.get(`${baseURL}/api/admin/story-stories`)).status()).toBe(401);
    await page.goto("/admin/story/stories");
    await expect(page).toHaveURL(/\/admin\/login$/);

    await page.getByLabel("显示名称").fill("Story E2E Super Admin");
    await page.getByLabel("管理员邮箱").fill(superEmail);
    await page.getByLabel("初始密码").fill(superPassword);
    await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
    await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    const api = context.request;
    const mutationHeaders = { origin, "content-type": "application/json" };
    expect(
      (await api.get(`${baseURL}/api/admin/story-stories?filter[unknown][eq]=x`)).status(),
    ).toBe(400);

    const databasePool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
    });
    const client = await databasePool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `INSERT INTO users (id, email, password_hash, display_name, role)
         VALUES (103, 'no-billing-story@example.test', 'fixture-password-hash-not-a-credential', '未绑定创作者', 'user')`,
      );
      await client.query(
        `INSERT INTO story_workspace_workspaces (id, name, owner_id, settings)
         VALUES ('workspace-no-billing-story', '无计费映射工作区', 103, '{"language":"zh-CN"}'::jsonb)`,
      );
      await client.query(
        `INSERT INTO story_workspace_stories (
           id, identifier, title, description, author_id, workspace_id,
           character_count, scene_count, agent_generated
         ) VALUES (
           'story-no-billing-story', 'story-no-billing-story',
           '无计费映射仍显示的剧本', '安全说明字段',
           103, 'workspace-no-billing-story', 0, 0, 0
         )`,
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const sqlCounts = await databasePool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM story_workspace_workspaces) AS workspaces,
         (SELECT COUNT(*)::int FROM story_workspace_stories) AS stories,
         (SELECT COUNT(*)::int
            FROM users u
            LEFT JOIN platform_users pu
              ON pu.source = 'ink-dream' AND pu.external_user_id = u.id::text
           WHERE pu.id IS NULL) AS users_without_billing_identity`,
    );
    expect(sqlCounts.rows[0]).toMatchObject({
      workspaces: 3,
      stories: 3,
      users_without_billing_identity: 1,
    });

    const workspaceResponse = await api.get(
      `${baseURL}/api/admin/story-workspaces?page=1&pageSize=20&sort=updated_at&order=desc`,
    );
    const workspaceBody = await workspaceResponse.json();
    expect(workspaceResponse.status()).toBe(200);
    expect(workspaceBody.meta.total).toBe(sqlCounts.rows[0].workspaces);
    expect(workspaceBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "workspace-no-billing-story",
        owner_id: "103",
        billing_identity_bound: false,
        relation_health: "healthy",
      }),
    ]));

    const storyResponse = await api.get(
      `${baseURL}/api/admin/story-stories?page=1&pageSize=20&sort=updated_at&order=desc`,
    );
    const storyBody = await storyResponse.json();
    expect(storyResponse.status()).toBe(200);
    expect(storyBody.meta.total).toBe(sqlCounts.rows[0].stories);
    expect(storyBody.data).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "story-no-billing-story",
        author_id: "103",
        billing_identity_bound: false,
        relation_health: "healthy",
        content_length: null,
      }),
    ]));
    expect(
      storyBody.data.every((story: Record<string, unknown>) => !("content" in story)),
    ).toBe(true);
    expect((await api.get(`${baseURL}/api/admin/stories`)).status()).toBe(200);

    const rangeResponse = await api.get(
      `${baseURL}/api/admin/story-stories?page=2&pageSize=1&sort=updated_at&order=asc&filter[status][eq]=draft&filter[updated_at][gte]=2000-01-01T00%3A00%3A00.000Z`,
    );
    expect(rangeResponse.status()).toBe(200);
    const rangeBody = await rangeResponse.json();
    expect(rangeBody.data).toHaveLength(1);
    expect(rangeBody.meta.total).toBe(3);
    expect(rangeBody.meta.page).toBe(2);

    const storyRequests: string[] = [];
    page.on("request", (browserRequest) => {
      const pathname = new URL(browserRequest.url()).pathname;
      if (pathname.includes("/api/admin/stor")) storyRequests.push(pathname);
    });

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/admin/story/stories");
    await expect(page.getByText("无计费映射仍显示的剧本", { exact: true })).toBeVisible();
    await expect(page.getByText("未绑定计费身份", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("3 条记录", { exact: true })).toBeVisible();
    expect(storyRequests).toContain("/api/admin/story-stories");
    expect(storyRequests).not.toContain("/api/admin/stories");
    await noDocumentOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("story-data-desktop-1440x1000.png"),
      fullPage: true,
      caret: "initial",
    });

    const safeStoryRow = page.locator("tbody tr").filter({ hasText: "无计费映射仍显示的剧本" });
    await safeStoryRow.getByRole("button", { name: "查看" }).click();
    await expect(page.getByRole("dialog").getByText("content_length", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).not.toContainText("fixture-password-hash-not-a-credential");
    await page.getByRole("dialog").getByRole("button", { name: "关闭" }).click();

    await page.getByLabel("剧本标题").fill("不存在的标题");
    await page.getByRole("button", { name: "应用", exact: true }).click();
    await expect(page).toHaveURL(/title=/);
    await expect(page.locator('[data-state="filter-empty"]')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("story-filter-empty-desktop-1440x1000.png"),
      fullPage: true,
      caret: "initial",
    });
    await page.getByRole("button", { name: "清除筛选", exact: true }).first().click();
    await expect(page).not.toHaveURL(/title=/);
    await page.reload();
    await expect(page.getByText("无计费映射仍显示的剧本", { exact: true })).toBeVisible();

    await page.route("**/api/admin/story-stories?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: [], meta: { page: 1, pageSize: 12, total: 0, totalPages: 0 } }),
      });
    });
    await page.reload();
    await expect(page.locator('[data-state="system-empty"]')).toBeVisible();
    await expect(page.locator('[data-state="filter-empty"]')).toHaveCount(0);
    await page.unroute("**/api/admin/story-stories?**");

    for (const failure of [
      { status: 404, code: "STORY_RELATION_NOT_FOUND", title: "关联记录不存在" },
      { status: 409, code: "STORY_RELATION_CONFLICT", title: "关系或状态已经变化" },
      { status: 500, code: "STORY_SOURCE_ERROR", title: "Story 服务发生异常" },
      { status: 503, code: "STORY_SOURCE_UNAVAILABLE", title: "PostgreSQL 数据源不可用" },
    ]) {
      await page.route("**/api/admin/story-stories?**", async (route) => {
        await route.fulfill({
          status: failure.status,
          contentType: "application/json",
          body: JSON.stringify({
            error: {
              code: failure.code,
              message: "safe Story failure",
              requestId: `story-${failure.status}-e2e`,
            },
          }),
        });
      });
      await page.reload();
      await expect(page.locator(`[data-state="error-${failure.status}"]`)).toBeVisible();
      await expect(page.getByText(failure.title, { exact: true })).toBeVisible();
      await expect(page.locator('[data-state="system-empty"]')).toHaveCount(0);
      await expect(page.locator('[data-state="filter-empty"]')).toHaveCount(0);
      if (failure.status === 503) {
        await page.screenshot({
          path: testInfo.outputPath("story-database-unavailable-desktop-1440x1000.png"),
          fullPage: true,
          caret: "initial",
        });
      }
      await page.unroute("**/api/admin/story-stories?**");
    }
    await page.reload();

    await page.goto("/admin/resources/users");
    const unboundUserRow = page.locator("tbody tr").filter({ hasText: "no-billing-story@example.test" });
    await expect(unboundUserRow).toBeVisible();
    await unboundUserRow.getByRole("link", { name: "1", exact: true }).first().click();
    await expect(page).toHaveURL(/\/admin\/story\/workspaces\?owner_id=103/);
    await expect(page.getByText("无计费映射工作区", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();

    await page.goto("/admin/story/workspaces");
    const unboundWorkspaceRow = page.locator("tbody tr").filter({ hasText: "无计费映射工作区" });
    await expect(unboundWorkspaceRow.getByText("未绑定计费身份", { exact: true })).toBeVisible();
    await unboundWorkspaceRow.getByRole("link", { name: "1", exact: true }).click();
    await expect(page).toHaveURL(/workspace_id=workspace-no-billing-story/);
    await expect(page.getByText("无计费映射仍显示的剧本", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();

    await page.goto("/admin/story/workspaces");
    await expect(page.getByText("无计费映射工作区", { exact: true })).toBeVisible();
    await expect(page.getByText("3 条记录", { exact: true })).toBeVisible();
    await noDocumentOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("story-workspaces-desktop-1440x1000.png"),
      fullPage: true,
      caret: "initial",
    });

    await page.goto("/admin/story/stories");
    const confirmRow = page.locator("tbody tr").filter({ hasText: "真实源剧本" });
    await confirmRow.getByRole("button", { name: "确认" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "确认" }).click();
    await expect(confirmRow.getByText("published", { exact: true })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/story/stories");
    await expect(page.getByText("无计费映射仍显示的剧本", { exact: true })).toBeVisible();
    await noDocumentOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("story-data-mobile-390x844.png"),
      caret: "initial",
    });
    await page.goto("/admin/story/workspaces");
    await expect(page.getByText("无计费映射工作区", { exact: true })).toBeVisible();
    await noDocumentOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("story-workspaces-mobile-390x844.png"),
      caret: "initial",
    });

    expect((await api.get(`${baseURL}/api/admin/storage-resources`)).status()).toBe(200);
    expect((await api.get(`${baseURL}/api/admin/providers`)).status()).toBe(200);
    expect((await api.get(`${baseURL}/api/admin/gateway-requests`)).status()).toBe(200);
    expect((await api.get(`${baseURL}/api/admin/billing-accounts`)).status()).toBe(200);

    const auditor = await api.post(`${baseURL}/api/admin/admin-users`, {
      headers: mutationHeaders,
      data: {
        email: auditorEmail,
        displayName: "Story E2E Auditor",
        password: auditorPassword,
        roleCodes: ["auditor"],
      },
    });
    expect(auditor.status()).toBe(201);
    await context.clearCookies();
    await page.goto("/admin/login");
    await page.getByLabel("管理员邮箱").fill(auditorEmail);
    await page.getByLabel("密码").fill(auditorPassword);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    expect(
      (await context.request.patch(`${baseURL}/api/admin/story-stories/story-other`, {
        headers: mutationHeaders,
        data: { title: "auditor cannot write" },
      })).status(),
    ).toBe(403);

    expect((await request.get(`${baseURL}/customers`)).status()).toBe(404);
    expect((await request.get(`${baseURL}/todos`)).status()).toBe(404);
    expect((await request.get(`${baseURL}/api/customers`)).status()).toBe(404);
    expect((await request.get(`${baseURL}/api/claude-agent`)).status()).toBe(404);

    await databasePool.end();
    expect(diagnostics).toEqual([]);
  });
});
