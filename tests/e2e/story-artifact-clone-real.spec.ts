import { expect, test, type Page } from "@playwright/test";
import pg from "pg";

const storyId = process.env.INK_CLONE_STORY_ID;
const rejectStoryId = process.env.INK_CLONE_REJECT_STORY_ID;
const runId = process.env.INK_CLONE_RUN_ID;
const projectId = process.env.INK_CLONE_PROJECT_ID;
const scriptRevision = process.env.INK_CLONE_SCRIPT_REVISION;
const rejectScriptRevision = process.env.INK_CLONE_REJECT_SCRIPT_REVISION;
const adminEmail = process.env.INK_CLONE_ADMIN_EMAIL;
const adminPassword = process.env.INK_CLONE_ADMIN_PASSWORD;

function diagnosticsFor(page: Page) {
  const diagnostics: string[] = [];
  const preAuthDiagnostics: string[] = [];
  let authenticated = false;
  const record = (value: string) => {
    (authenticated ? diagnostics : preAuthDiagnostics).push(value);
  };
  page.on("console", (message) => {
    if (message.type() === "error") record(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => record(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    if (request.failure()?.errorText !== "net::ERR_ABORTED") {
      record(
        `requestfailed: ${request.failure()?.errorText ?? "failed"} ${request.url()}`,
      );
    }
  });
  page.on("response", (response) => {
    if (response.status() >= 500 && response.url().includes("/api/")) {
      diagnostics.push(`http ${response.status()}: ${response.url()}`);
    }
  });
  return {
    diagnostics,
    preAuthDiagnostics,
    markAuthenticated() { authenticated = true; },
  };
}

test.describe("real restored Dream Story review", () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(
    !storyId || !rejectStoryId || !runId || !projectId || !scriptRevision
      || !rejectScriptRevision || !adminEmail || !adminPassword
      || !process.env.TEST_DATABASE_URL,
    "Requires the owned read-only-source PostgreSQL clone runner",
  );

  test("reads real artifacts and applies revision-guarded idempotent review", async ({
    context,
    page,
    baseURL,
  }) => {
    const diagnosticState = diagnosticsFor(page);
    await page.route("http://unpkg.com/react-grab/dist/index.global.js", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/javascript",
        body: "",
      });
    });
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const before = await pool.query(
      `SELECT source_run_id, source_thread_ref, source_project_id, episode_count,
              artifact_status, artifact_manifest_revision, script_revision,
              artifact_sync_status, script_size_bytes, reconcile_version
       FROM story_workspace_stories WHERE id = $1`,
      [storyId],
    );
    expect(before.rowCount).toBe(1);

    await page.goto("/admin/login");
    await page.getByLabel("管理员邮箱").fill(adminEmail!);
    await page.getByLabel("密码").fill(adminPassword!);
    await page.getByRole("button", { name: "登录控制台" }).click();
    await expect(page).toHaveURL(/\/admin$/);
    diagnosticState.markAuthenticated();
    expect(
      diagnosticState.preAuthDiagnostics.every((value) =>
        value.includes("401")),
    ).toBe(true);

    const api = context.request;
    const list = await api.get(
      `${baseURL}/api/admin/story-stories?filter[source_project_id][eq]=${projectId}`,
    );
    expect(list.status()).toBe(200);
    const listBody = await list.json();
    expect(listBody.meta.total).toBe(1);
    expect(listBody.data[0]).toMatchObject({
      id: storyId,
      source_run_id: runId,
      source_project_id: projectId,
      artifact_status: "available",
      artifact_sync_status: "indexed",
      script_revision: scriptRevision,
    });
    expect(listBody.data[0]).not.toHaveProperty("source_thread_ref");
    expect(listBody.data[0]).not.toHaveProperty("content");

    const surface = await api.get(
      `${baseURL}/api/admin/story-stories/${storyId}/artifact-surface`,
    );
    expect(surface.status()).toBe(200);
    const surfaceBody = await surface.json();
    expect(surfaceBody.data).toMatchObject({
      storyId,
      projectId,
      sourceRunId: runId,
    });
    expect(JSON.stringify(surfaceBody)).not.toContain("/Users/");

    const preview = await api.get(
      `${baseURL}/api/admin/story-stories/${storyId}/artifacts`
        + `?episodeId=EP01&kind=script&offset=0&limit=65536&revision=${scriptRevision}`,
    );
    expect(preview.status()).toBe(200);
    const previewBody = await preview.json();
    expect(previewBody.data).toMatchObject({
      storyId,
      projectId,
      episodeId: "EP01",
      kind: "script",
      revision: scriptRevision,
    });
    expect(previewBody.data.content.length).toBeGreaterThan(0);
    expect(JSON.stringify(previewBody)).not.toContain("/Users/");

    const origin = new URL(baseURL!).origin;
    const stale = await api.post(
      `${baseURL}/api/admin/story-stories/${storyId}/confirm`,
      {
        headers: { origin, "content-type": "application/json" },
        data: { expectedScriptRevision: `sha256:${"0".repeat(64)}` },
      },
    );
    expect(stale.status()).toBe(409);

    const confirmRequestId = `clone-confirm-${storyId}`;
    const confirm = await api.post(
      `${baseURL}/api/admin/story-stories/${storyId}/confirm`,
      {
        headers: {
          origin,
          "content-type": "application/json",
          "x-request-id": confirmRequestId,
        },
        data: { expectedScriptRevision: scriptRevision },
      },
    );
    expect(confirm.status()).toBe(200);
    expect(confirm.headers()["idempotency-replayed"]).toBeUndefined();
    const confirmReplay = await api.post(
      `${baseURL}/api/admin/story-stories/${storyId}/confirm`,
      {
        headers: {
          origin,
          "content-type": "application/json",
          "x-request-id": confirmRequestId,
        },
        data: { expectedScriptRevision: scriptRevision },
      },
    );
    expect(confirmReplay.status()).toBe(200);
    expect(confirmReplay.headers()["idempotency-replayed"]).toBe("true");

    const rejectRequestId = `clone-reject-${rejectStoryId}`;
    const reject = await api.post(
      `${baseURL}/api/admin/story-stories/${rejectStoryId}/reject`,
      {
        headers: {
          origin,
          "content-type": "application/json",
          "x-request-id": rejectRequestId,
        },
        data: {
          expectedScriptRevision: rejectScriptRevision,
          reviewNotes: "clone E2E revision rejection",
        },
      },
    );
    expect(reject.status()).toBe(200);

    const after = await pool.query(
      `SELECT source_run_id, source_thread_ref, source_project_id, episode_count,
              artifact_status, artifact_manifest_revision, script_revision,
              artifact_sync_status, script_size_bytes, reconcile_version,
              review_status, reviewed_script_revision, confirmed_at
       FROM story_workspace_stories WHERE id = $1`,
      [storyId],
    );
    expect(after.rows[0]).toMatchObject({
      ...before.rows[0],
      review_status: "confirmed",
      reviewed_script_revision: scriptRevision,
    });
    expect(after.rows[0].confirmed_at).not.toBeNull();
    const rejected = await pool.query(
      `SELECT review_status, review_notes, reviewed_script_revision, confirmed_at
       FROM story_workspace_stories WHERE id = $1`,
      [rejectStoryId],
    );
    expect(rejected.rows[0]).toMatchObject({
      review_status: "rejected",
      review_notes: "clone E2E revision rejection",
      reviewed_script_revision: rejectScriptRevision,
      confirmed_at: null,
    });
    const audits = await pool.query(
      `SELECT request_id, action, resource_type, resource_id, COUNT(*)::int AS count
       FROM admin_audit_logs
       WHERE request_id = ANY($1::text[])
       GROUP BY request_id, action, resource_type, resource_id
       ORDER BY request_id`,
      [[confirmRequestId, rejectRequestId]],
    );
    expect(audits.rows).toEqual([
      {
        request_id: confirmRequestId,
        action: "confirm",
        resource_type: "story-stories",
        resource_id: storyId,
        count: 1,
      },
      {
        request_id: rejectRequestId,
        action: "reject",
        resource_type: "story-stories",
        resource_id: rejectStoryId,
        count: 1,
      },
    ]);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/admin/story/stories?source_project_id=${projectId}`);
    const row = page.locator("tbody tr").filter({ hasText: projectId! });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "查看" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("story-index-rail")).toContainText("indexed");
    await expect(dialog.getByTestId("story-artifact-preview")).not.toBeEmpty();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);
    await dialog.getByRole("button", { name: "关闭" }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    const mobileRow = page.locator("tbody tr").filter({ hasText: projectId! });
    await mobileRow.getByRole("button", { name: "查看" }).click();
    await expect(page.getByRole("dialog").getByTestId("story-artifact-preview"))
      .not.toBeEmpty();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ),
    ).toBeLessThanOrEqual(1);

    await pool.end();
    expect(diagnosticState.diagnostics).toEqual([]);
  });
});
