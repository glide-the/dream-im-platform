// [Input] Named disposable PostgreSQL, restricted role and Registry115 Guidance DTO-Service-ORM path.
// [Output] Owner/state checks, immutable message, exact/business replay, concurrency, receipt and ACL evidence.
// [Pos] Isolated destructive Guidance contract test; it never runs without dedicated harness URLs.
// [Sync] 2026-09-15: verify Story Workspace Guidance against migrated PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runStoryWorkspaceGuidanceOperation } from "./storyWorkspaceGuidanceService";

const adminUrl = process.env.STORY_WORKSPACE_GUIDANCE_TEST_ADMIN_URL;
const restrictedUrl = process.env.STORY_WORKSPACE_GUIDANCE_TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && restrictedUrl);
const runId = `run_${"a".repeat(32)}`;
const foreignRunId = `run_${"b".repeat(32)}`;
const pendingRunId = `run_${"c".repeat(32)}`;
const concurrentRunId = `run_${"d".repeat(32)}`;
const principal = (id: string) => ({ subject: `guidance-subject-${id}`, canonical_user_id: id,
  client_id: "dream-browser", scopes: ["dream:write"], status: "active" });
const input = (id = runId, text = "第二集节奏放慢", key = "guide-1") => ({
  workflow_run_id: id, kind: "free-text" as const, text, step_id: null, idempotency_key: key,
});

describe.skipIf(!enabled)("Story Workspace Guidance PostgreSQL contract", () => {
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const restrictedPool = new pg.Pool({ connectionString: restrictedUrl, max: 6 });
  const database = drizzle(restrictedPool);

  beforeAll(async () => {
    const identity = await admin.query("SELECT current_database() AS database, current_user AS actor");
    expect(String(identity.rows[0].database)).toMatch(/^ink_story_workspace_guidance_test_[a-z0-9_]+$/);
    expect(String(identity.rows[0].actor)).toBe("postgres");
    await admin.query(`
      INSERT INTO users (id, email, password_hash) VALUES
        (1, 'guidance-one@example.invalid', 'fixture'),
        (2, 'guidance-two@example.invalid', 'fixture');
      INSERT INTO story_workspace_workspaces (id, name, owner_id, settings) VALUES
        ('workspace-1', 'Writer One', 1, '{}'),
        ('workspace-2', 'Writer Two', 2, '{}');
      INSERT INTO chat_thread (id, user_id, title) VALUES
        ('thread-guidance-1', 1, 'Guidance Thread'),
        ('thread-guidance-2', 2, 'Foreign Thread'),
        ('thread-guidance-concurrent', 1, 'Concurrent Thread');
      ALTER TABLE workflow_runs DISABLE TRIGGER ALL;
      INSERT INTO workflow_runs
        (id, workspace_id, deck_plugin_id, deck_plugin_version, workflow_definition_ref,
         deck_runtime_snapshot_id, status, deck_plugin_manifest_hash, deck_plugin_binding_id,
         binding_revision, runtime_plugin_lock_id, workflow_preflight_id, source_voice_thread_id,
         idempotency_key, input_hash, semantic_fingerprint, created_by)
      VALUES
        ('${runId}', 'workspace-1', 'story-plugin', '1.0.0', 'workflow://story', 'snapshot-1',
         'confirmed', 'sha256:${"1".repeat(64)}', 'binding-1', 1, 'lock-1', 'pf_${"1".repeat(32)}',
         'thread-guidance-1', 'run-key-1', 'sha256:${"2".repeat(64)}', 'sha256:${"3".repeat(64)}', '1'),
        ('${foreignRunId}', 'workspace-2', 'story-plugin', '1.0.0', 'workflow://story', 'snapshot-2',
         'confirmed', 'sha256:${"4".repeat(64)}', 'binding-2', 1, 'lock-2', 'pf_${"2".repeat(32)}',
         'thread-guidance-2', 'run-key-2', 'sha256:${"5".repeat(64)}', 'sha256:${"6".repeat(64)}', '2'),
        ('${pendingRunId}', 'workspace-1', 'story-plugin', '1.0.0', 'workflow://story', 'snapshot-3',
         'pending_review', 'sha256:${"7".repeat(64)}', 'binding-3', 1, 'lock-3', 'pf_${"3".repeat(32)}',
         'thread-guidance-1', 'run-key-3', 'sha256:${"8".repeat(64)}', 'sha256:${"9".repeat(64)}', '1'),
        ('${concurrentRunId}', 'workspace-1', 'story-plugin', '1.0.0', 'workflow://story', 'snapshot-4',
         'failed', 'sha256:${"a".repeat(64)}', 'binding-4', 1, 'lock-4', 'pf_${"4".repeat(32)}',
         'thread-guidance-concurrent', 'run-key-4', 'sha256:${"b".repeat(64)}', 'sha256:${"c".repeat(64)}', '1');
      ALTER TABLE workflow_runs ENABLE TRIGGER ALL;
    `);
  });

  afterAll(async () => { await restrictedPool.end(); await admin.end(); });

  it("commits one immutable message and exact request receipt", async () => {
    const execute = () => database.transaction(tx => runStoryWorkspaceGuidanceOperation(
      "story-workspace-guidance.submit", input(), principal("1"), "dream-service", "guidance-original", tx));
    const first = await execute(); const exact = await execute();
    expect(exact).toEqual(first);
    expect(first).toMatchObject({ message_id: "guide_guide-1", replayed: false,
      request_id: "guidance-original", dispatch: { thread_id: "thread-guidance-1",
        metadata: { actor: "1", command_kind: "free-text" } } });
    const stored = await admin.query(`SELECT role, parts::jsonb AS parts, metadata::jsonb AS metadata
      FROM chat_message WHERE id='guide_guide-1'`);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0]).toMatchObject({ role: "user", metadata: {
      story_workspace_run_id: runId, actor: "1", request_id: "guidance-original" } });
    const evidence = await admin.query(`SELECT
      (SELECT count(*)::int FROM dream.operation_receipts WHERE request_id='guidance-original') AS receipts,
      (SELECT count(*)::int FROM admin_audit_logs WHERE request_id='guidance-original'
        AND action='dream.story-workspace-guidance.submit') AS audits`);
    expect(evidence.rows[0]).toEqual({ receipts: 1, audits: 1 });
  });

  it("returns a read-only business replay and rejects a changed command", async () => {
    const before = await admin.query("SELECT updated_at FROM chat_thread WHERE id='thread-guidance-1'");
    const replay = await database.transaction(tx => runStoryWorkspaceGuidanceOperation(
      "story-workspace-guidance.submit", input(), principal("1"), "dream-service", "guidance-replay", tx));
    const after = await admin.query("SELECT updated_at FROM chat_thread WHERE id='thread-guidance-1'");
    expect(replay).toMatchObject({ replayed: true, request_id: "guidance-original", dispatch: null });
    expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at);
    await expect(database.transaction(tx => runStoryWorkspaceGuidanceOperation(
      "story-workspace-guidance.submit", input(runId, "不同内容"), principal("1"),
      "dream-service", "guidance-conflict", tx)))
      .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", status: 409 });
    expect((await admin.query("SELECT count(*)::int AS total FROM dream.operation_receipts WHERE request_id='guidance-conflict'")).rows[0].total).toBe(0);
  });

  it("serializes concurrent identical commands into one dispatch and one replay", async () => {
    const concurrentInput = input(concurrentRunId, "重试失败步骤", "guide-race");
    const [left, right] = await Promise.all([
      database.transaction(tx => runStoryWorkspaceGuidanceOperation(
        "story-workspace-guidance.submit", concurrentInput, principal("1"), "dream-service", "guidance-race-a", tx)),
      database.transaction(tx => runStoryWorkspaceGuidanceOperation(
        "story-workspace-guidance.submit", concurrentInput, principal("1"), "dream-service", "guidance-race-b", tx)),
    ]);
    expect([left.replayed, right.replayed].sort()).toEqual([false, true]);
    expect([left.dispatch, right.dispatch].filter(Boolean)).toHaveLength(1);
    expect((await admin.query("SELECT count(*)::int AS total FROM chat_message WHERE id='guide_guide-race'")).rows[0].total).toBe(1);
  });

  it("fails closed for foreign and non-guidable Runs without persistence", async () => {
    await expect(database.transaction(tx => runStoryWorkspaceGuidanceOperation(
      "story-workspace-guidance.submit", input(foreignRunId, "越权", "foreign"),
      principal("1"), "dream-service", "guidance-foreign", tx)))
      .rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_FOUND", status: 404 });
    await expect(database.transaction(tx => runStoryWorkspaceGuidanceOperation(
      "story-workspace-guidance.submit", input(pendingRunId, "过早", "pending"),
      principal("1"), "dream-service", "guidance-pending", tx)))
      .rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_GUIDABLE", status: 409 });
    expect((await admin.query("SELECT count(*)::int AS total FROM chat_message WHERE id IN ('guide_foreign','guide_pending')")).rows[0].total).toBe(0);
  });

  it("uses a role without direct users or unrelated Admin table access", async () => {
    expect((await restrictedPool.query("SELECT current_user AS actor")).rows[0].actor)
      .toBe("ink_story_guidance_executor");
    await expect(restrictedPool.query("SELECT email FROM users LIMIT 1"))
      .rejects.toMatchObject({ code: "42501" });
  });
});
