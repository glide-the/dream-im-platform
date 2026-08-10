import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const bootstrapToken = process.env.ADMIN_BOOTSTRAP_E2E_TOKEN;
const artifactRoot = process.env.ARTIFACT_WORKSPACE_ROOT;
const adminEmail = "story-artifact-admin@example.test";
const adminPassword = "Story-artifact-admin-2026!";
const runId = `run_${"a".repeat(32)}`;
const threadRef = "thread-artifact-e2e";
const projectId = "project-artifact-e2e";
const storyId = "story-artifact-e2e";

function collectDiagnostics(page: Page) {
  const diagnostics: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !message.text().includes("server responded with a status of 401") &&
      !message.text().includes("server responded with a status of 503")
    ) diagnostics.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => diagnostics.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const reason = request.failure()?.errorText ?? "failed";
    if (reason !== "net::ERR_ABORTED") diagnostics.push(`${reason}: ${request.url()}`);
  });
  page.on("response", (response) => {
    if (
      response.status() >= 500 &&
      !(response.status() === 503 && response.url().includes("/artifact-surface"))
    ) diagnostics.push(`http ${response.status()}: ${response.url()}`);
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

async function writeArtifactFixture() {
  const thread = join(artifactRoot!, threadRef);
  const runRoot = join(thread, ".dream", "runtime", "runs", runId);
  const projectRoot = join(thread, "stories", projectId);
  await mkdir(runRoot, { recursive: true });
  await Promise.all([
    mkdir(join(projectRoot, "episodes", "EP01"), { recursive: true }),
    mkdir(join(projectRoot, "episodes", "EP02"), { recursive: true }),
  ]);
  await writeFile(
    join(runRoot, "episode.json"),
    JSON.stringify({
      schema_version: "dream-episode/v2",
      workflow_run_id: runId,
      story_slug: projectId,
      active_episode_uid: "1".repeat(32),
      episodes: [
        {
          episode_uid: "1".repeat(32),
          episode_number: 1,
          episode_code: "EP01",
          episode_root: `stories/${projectId}/episodes/EP01`,
          created_at: "2026-08-10T00:00:00Z",
        },
        {
          episode_uid: "2".repeat(32),
          episode_number: 2,
          episode_code: "EP02",
          episode_root: `stories/${projectId}/episodes/EP02`,
          created_at: "2026-08-10T00:01:00Z",
        },
      ],
      revision: 2,
      updated_at: "2026-08-10T00:01:00Z",
    }),
    "utf8",
  );
  await writeFile(
    join(projectRoot, "project.yaml"),
    `project_id: ${projectId}\nproject_name: "共享文件系统验收剧本"\n`,
    "utf8",
  );
  const ep01 = "# EP01：雨夜来信\n\n林深收到一封来自明天的信。\n";
  await writeFile(join(projectRoot, "episodes", "EP01", "script.md"), ep01, "utf8");
  await writeFile(join(projectRoot, "episodes", "EP01", "episode-outline.md"), "# 大纲\n雨夜，来信，选择。\n", "utf8");
  await writeFile(join(projectRoot, "episodes", "EP01", "storyboard.yaml"), "shots:\n  - id: shot-01\n", "utf8");
  await writeFile(join(projectRoot, "episodes", "EP01", "review-report.md"), "# Review\n通过。\n", "utf8");
  await writeFile(join(projectRoot, "episodes", "EP02", "script.md"), "# EP02\n第二封信。\n", "utf8");
  return {
    script: ep01,
    revision: `sha256:${createHash("sha256").update(ep01).digest("hex")}`,
  };
}

test.describe("Story Artifact shared read-only root", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(
    !bootstrapToken || !process.env.TEST_DATABASE_URL || !artifactRoot,
    "Requires an owned isolated PostgreSQL, bootstrap token, and temporary Artifact root",
  );

  test("keeps PostgreSQL and Artifact facts separate across desktop and mobile", async ({
    context,
    page,
    request,
    baseURL,
  }, testInfo) => {
    const diagnostics = collectDiagnostics(page);
    await page.route("http://unpkg.com/react-grab/dist/index.global.js", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/javascript", body: "" });
    });
    const fixture = await writeArtifactFixture();
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });

    expect((await request.get(`${baseURL}/api/admin/story-stories/${storyId}/artifact-surface`)).status()).toBe(401);
    await page.goto("/admin/story/stories");
    await page.getByLabel("显示名称").fill("Story Artifact Admin");
    await page.getByLabel("管理员邮箱").fill(adminEmail);
    await page.getByLabel("初始密码").fill(adminPassword);
    await page.getByLabel("首次启动密钥").fill(bootstrapToken!);
    await page.getByRole("button", { name: "创建管理员并进入控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);

    await pool.query(
      `INSERT INTO users (id, email, password_hash, display_name, role)
       VALUES (201, 'artifact-author@example.test', 'fixture-hash', 'Artifact 作者', 'user')`,
    );
    await pool.query(
      `INSERT INTO story_workspace_workspaces (id, name, owner_id, settings)
       VALUES ('workspace-artifact-e2e', 'Artifact 验收工作区', 201, '{}'::jsonb)`,
    );
    await pool.query(
      `INSERT INTO story_workspace_stories (
         id, identifier, title, description, author_id, workspace_id,
         character_count, scene_count, agent_generated,
         artifact_source_type, source_run_id, source_thread_ref,
         source_project_id, episode_count, artifact_manifest_revision,
         script_revision, artifact_sync_status, artifact_indexed_at,
         script_size_bytes, artifact_available, reconcile_version
       ) VALUES (
         $1, $1, '共享文件系统验收剧本', '只读 Artifact 验收', 201,
         'workspace-artifact-e2e', 0, 0, 1,
         'dream_episode', $2, $3, $4, 2, $5, $6,
         'indexed', CURRENT_TIMESTAMP, $7, TRUE, 1
       )`,
      [storyId, runId, threadRef, projectId, `sha256:${"b".repeat(64)}`, fixture.revision, Buffer.byteLength(fixture.script)],
    );

    const api = context.request;
    const listResponse = await api.get(`${baseURL}/api/admin/story-stories?filter[source_project_id][eq]=${projectId}`);
    const listBody = await listResponse.json();
    expect(listResponse.status()).toBe(200);
    expect(listBody.meta.total).toBe(1);
    expect(listBody.data[0]).toMatchObject({
      id: storyId,
      source_project_id: projectId,
      episode_count: 2,
      script_revision: fixture.revision,
      artifact_sync_status: "indexed",
    });
    expect(listBody.data[0]).not.toHaveProperty("source_thread_ref");
    expect(listBody.data[0]).not.toHaveProperty("content");

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/admin/story/stories?source_project_id=${projectId}`);
    const row = page.locator("tbody tr").filter({ hasText: "共享文件系统验收剧本" });
    await expect(row).toBeVisible();
    await expect(page.getByText("1 条记录", { exact: true })).toBeVisible();
    await noDocumentOverflow(page);
    await row.getByRole("button", { name: "查看" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("story-index-rail")).toContainText("indexed");
    await expect(dialog.getByTestId("story-artifact-rail")).toContainText("可读取");
    await expect(dialog.getByTestId("story-artifact-preview")).toContainText("雨夜来信");
    await expect(dialog).not.toContainText(artifactRoot!);
    await noDocumentOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("story-artifact-desktop-1440x1000.png"),
      fullPage: true,
      caret: "initial",
    });

    const previewUrl = `${baseURL}/api/admin/story-stories/${storyId}/artifacts?episodeId=EP01&kind=script&offset=0&limit=65536&revision=${fixture.revision}`;
    const previewResponse = await api.get(previewUrl);
    expect(previewResponse.status()).toBe(200);
    const etag = previewResponse.headers()["etag"];
    expect(etag).toBe(`"${fixture.revision}"`);
    expect((await api.get(previewUrl, { headers: { "if-none-match": etag } })).status()).toBe(304);
    expect(
      (await api.get(`${baseURL}/api/admin/story-stories/${storyId}/artifacts?episodeId=../../etc&kind=secret`)).status(),
    ).toBe(422);

    const origin = new URL(baseURL!).origin;
    const confirm = await api.post(`${baseURL}/api/admin/story-stories/${storyId}/confirm`, {
      headers: { origin, "content-type": "application/json" },
      data: { expectedScriptRevision: fixture.revision },
    });
    expect(confirm.status()).toBe(200);
    const reviewed = await pool.query(
      `SELECT status, review_status, reviewed_script_revision
       FROM story_workspace_stories WHERE id = $1`,
      [storyId],
    );
    expect(reviewed.rows[0]).toMatchObject({
      status: "draft",
      review_status: "confirmed",
      reviewed_script_revision: fixture.revision,
    });

    await dialog.getByRole("button", { name: "关闭" }).click();
    await page.route(`**/api/admin/story-stories/${storyId}/artifact-surface`, async (route) => {
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "STORY_ARTIFACT_STORE_UNAVAILABLE",
            message: "safe unavailable",
            requestId: "artifact-503-e2e",
          },
        }),
      });
    });
    await row.getByRole("button", { name: "查看" }).click();
    await expect(dialog.getByText("PostgreSQL 元数据", { exact: true })).toBeVisible();
    await expect(dialog.getByTestId("story-artifact-error-surface")).toContainText("共享 Artifact 文件系统不可用");
    await page.unroute(`**/api/admin/story-stories/${storyId}/artifact-surface`);
    await dialog.getByRole("button", { name: "关闭" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const mobileRow = page.locator("tbody tr").filter({ hasText: "共享文件系统验收剧本" });
    await mobileRow.getByRole("button", { name: "查看" }).click();
    await expect(page.getByRole("dialog").getByTestId("story-artifact-preview")).toContainText("雨夜来信");
    await noDocumentOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("story-artifact-mobile-390x844.png"),
      caret: "initial",
    });

    await pool.end();
    expect(diagnostics).toEqual([]);
  });
});
