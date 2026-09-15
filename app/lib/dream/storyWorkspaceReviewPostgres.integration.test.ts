// [Input] Explicitly named disposable PostgreSQL database, restricted execution role and Registry111 DTO-Service-ORM path.
// [Output] Owner isolation, cascade, batch order, idempotency, concurrency and full-rollback evidence.
// [Pos] Isolated destructive contract test; never runs without the dedicated harness URLs.
// [Sync] 2026-09-15: verify Story Workspace review transactions against real PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runStoryWorkspaceReviewOperation } from "./storyWorkspaceReviewService";

const adminUrl = process.env.STORY_WORKSPACE_REVIEW_TEST_ADMIN_URL;
const restrictedUrl = process.env.STORY_WORKSPACE_REVIEW_TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && restrictedUrl);
const actor = { principal: { subject: "review-subject-1", canonical_user_id: "1", client_id: "dream-browser",
  scopes: ["dream:read", "dream:write"], status: "active" }, threadScope: null, runScope: null };

describe.skipIf(!enabled)("Story Workspace review PostgreSQL contract", () => {
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const restrictedPool = new pg.Pool({ connectionString: restrictedUrl, max: 4 });
  const database = drizzle(restrictedPool);

  beforeAll(async () => {
    const identity = await admin.query("SELECT current_database() AS database, current_user AS actor");
    expect(String(identity.rows[0].database)).toMatch(/^ink_story_workspace_review_test_[a-z0-9_]+$/);
    expect(String(identity.rows[0].actor)).toBe("postgres");
    await admin.query(`
      INSERT INTO users (id, email, password_hash) VALUES
        (1, 'review-one@example.invalid', 'fixture'),
        (2, 'review-two@example.invalid', 'fixture');
      INSERT INTO story_workspace_workspaces (id, name, owner_id) VALUES
        ('workspace-1', 'Writer One', 1), ('workspace-2', 'Writer Two', 2);
      INSERT INTO story_workspace_stories
        (id, identifier, title, status, review_status, type, author_id, workspace_id, agent_generated, character_count, scene_count)
      VALUES
        ('story-bundle', 'story-bundle', 'Bundle', 'draft', 'pending', 'short', 1, 'workspace-1', 1, 1, 1),
        ('story-concurrent', 'story-concurrent', 'Concurrent', 'draft', 'pending', 'short', 1, 'workspace-1', 1, 0, 0),
        ('story-confirmed', 'story-confirmed', 'Confirmed', 'published', 'confirmed', 'short', 1, 'workspace-1', 1, 0, 0),
        ('story-foreign', 'story-foreign', 'Foreign', 'draft', 'pending', 'short', 2, 'workspace-2', 1, 0, 0),
        ('story-manual', 'story-manual', 'Manual', 'draft', 'pending', 'short', 1, 'workspace-1', 0, 0, 0),
        ('story-unsafe-output', 'story-unsafe-output', 'Unsafe output', 'draft', 'pending', 'script', 1, 'workspace-1', 1, 0, 0);
      UPDATE story_workspace_stories SET
        artifact_source_type='dream_episode', source_run_id='run-unsafe', source_thread_ref='thread-unsafe',
        source_project_id='unsafe-output', episode_count=1, artifact_status='available',
        artifact_manifest_revision='sha256:' || repeat('a',64), script_revision='sha256:' || repeat('b',64),
        artifact_sync_status='indexed', artifact_indexed_at=CURRENT_TIMESTAMP,
        script_size_bytes=9007199254740992, reconcile_version=1
      WHERE id='story-unsafe-output';
      INSERT INTO story_workspace_characters
        (id, identifier, name, author_id, workspace_id, story_count, review_status, agent_generated, status)
      VALUES
        ('character-bundle', 'character-bundle', 'Bundle role', 1, 'workspace-1', 1, 'pending', 1, 'active'),
        ('character-reject', 'character-reject', 'Reject role', 1, 'workspace-1', 0, 'pending', 1, 'active');
      INSERT INTO story_workspace_scenes
        (id, identifier, name, story_id, author_id, workspace_id, review_status, agent_generated, status, order_index)
      VALUES
        ('scene-bundle', 'scene-bundle', 'Bundle scene', 'story-bundle', 1, 'workspace-1', 'pending', 1, 'active', 0),
        ('scene-archive', 'scene-archive', 'Archive scene', NULL, 1, 'workspace-1', 'pending', 1, 'active', 1),
        ('scene-confirmed', 'scene-confirmed', 'Confirmed scene', NULL, 1, 'workspace-1', 'confirmed', 1, 'active', 2);
      INSERT INTO story_workspace_story_characters (story_id, character_id)
        VALUES ('story-bundle', 'character-bundle');
    `);
  });

  afterAll(async () => {
    await restrictedPool.end();
    await admin.end();
  });

  it("confirms an owned Story bundle atomically and replays the original receipt", async () => {
    const input = { resource_type: "story", resource_id: "story-bundle", action: "confirm", review_notes: null } as const;
    const execute = () => database.transaction(tx => runStoryWorkspaceReviewOperation(
      "story-workspace-review.transition", input, actor.principal, "dream-service", "review-bundle", tx));
    const first = await execute();
    const replay = await execute();
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ resource_type: "story", item: { id: "story-bundle",
      status: "published", review_status: "confirmed" } });
    expect(first.item).not.toHaveProperty("content");
    expect(first.item).not.toHaveProperty("source_thread_ref");
    const state = await admin.query(`SELECT
      (SELECT review_status FROM story_workspace_characters WHERE id='character-bundle') AS character,
      (SELECT review_status FROM story_workspace_scenes WHERE id='scene-bundle') AS scene,
      (SELECT count(*)::int FROM dream.operation_receipts WHERE request_id='review-bundle') AS receipts,
      (SELECT count(*)::int FROM admin_audit_logs WHERE request_id='review-bundle'
        AND action='dream.story-workspace-review.confirm') AS item_audits`);
    expect(state.rows[0]).toMatchObject({ character: "confirmed", scene: "confirmed", receipts: 1, item_audits: 1 });
  });

  it("isolates owners/manual rows and preserves single-state errors", async () => {
    for (const resourceId of ["story-foreign", "story-manual", "story-missing"]) {
      await expect(database.transaction(tx => runStoryWorkspaceReviewOperation(
        "story-workspace-review.transition",
        { resource_type: "story", resource_id: resourceId, action: "confirm", review_notes: null },
        actor.principal, "dream-service", `review-${resourceId}`, tx)))
        .rejects.toMatchObject({ code: "STORY_WORKSPACE_REVIEW_NOT_FOUND", status: 404 });
    }
    await expect(database.transaction(tx => runStoryWorkspaceReviewOperation(
      "story-workspace-review.transition",
      { resource_type: "story", resource_id: "story-confirmed", action: "confirm", review_notes: null },
      actor.principal, "dream-service", "review-invalid", tx)))
      .rejects.toMatchObject({ code: "STORY_WORKSPACE_REVIEW_STATE_INVALID", status: 409 });
  });

  it("rejects a Character and archives only eligible Scenes in request order", async () => {
    const rejected = await database.transaction(tx => runStoryWorkspaceReviewOperation(
      "story-workspace-review.transition",
      { resource_type: "character", resource_id: "character-reject", action: "reject", review_notes: "重写动机" },
      actor.principal, "dream-service", "review-character", tx));
    expect(rejected).toMatchObject({ resource_type: "character", item: {
      id: "character-reject", review_status: "rejected", review_notes: "重写动机" } });

    const batch = await database.transaction(tx => runStoryWorkspaceReviewOperation(
      "story-workspace-review.batch",
      { resource_type: "scene", ids: ["scene-archive", "scene-confirmed", "scene-missing"],
        action: "archive", review_notes: null }, actor.principal, "dream-service", "review-scenes", tx));
    expect(batch).toMatchObject({ total_requested: 3, total_updated: 1,
      skipped_ids: ["scene-confirmed", "scene-missing"] });
    if (batch.resource_type !== "scene") throw new Error("Expected Scene batch result");
    expect(batch.updated_items.map(item => item.id)).toEqual(["scene-archive"]);
    expect(batch.updated_items[0]).toMatchObject({ status: "archived" });
    expect(batch.updated_items[0].archived_at).toBeTruthy();
  });

  it("serializes concurrent approval so exactly one request commits", async () => {
    const command = { resource_type: "story", resource_id: "story-concurrent", action: "confirm", review_notes: null } as const;
    const attempts = await Promise.allSettled(["concurrent-a", "concurrent-b"].map(requestId =>
      database.transaction(tx => runStoryWorkspaceReviewOperation("story-workspace-review.transition",
        command, actor.principal, "dream-service", requestId, tx))));
    expect(attempts.filter(item => item.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find(item => item.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "STORY_WORKSPACE_REVIEW_STATE_INVALID", status: 409 } });
    const evidence = await admin.query(`SELECT
      (SELECT count(*)::int FROM dream.operation_receipts WHERE request_id IN ('concurrent-a','concurrent-b')) AS receipts,
      (SELECT count(*)::int FROM admin_audit_logs WHERE request_id IN ('concurrent-a','concurrent-b')
        AND action='dream.story-workspace-review.confirm') AS item_audits`);
    expect(evidence.rows[0]).toMatchObject({ receipts: 1, item_audits: 1 });
  });

  it("rolls back mutation and audits when the stored row cannot satisfy the public DTO", async () => {
    await expect(database.transaction(tx => runStoryWorkspaceReviewOperation(
      "story-workspace-review.transition",
      { resource_type: "story", resource_id: "story-unsafe-output", action: "confirm", review_notes: null },
      actor.principal, "dream-service", "review-unsafe", tx))).rejects.toBeTruthy();
    const evidence = await admin.query(`SELECT
      (SELECT review_status FROM story_workspace_stories WHERE id='story-unsafe-output') AS review_status,
      (SELECT status FROM story_workspace_stories WHERE id='story-unsafe-output') AS status,
      (SELECT count(*)::int FROM dream.operation_receipts WHERE request_id='review-unsafe') AS receipts,
      (SELECT count(*)::int FROM admin_audit_logs WHERE request_id='review-unsafe') AS audits`);
    expect(evidence.rows[0]).toMatchObject({ review_status: "pending", status: "draft", receipts: 0, audits: 0 });
  });

  it("uses a role without direct access to users or unrelated Admin tables", async () => {
    const role = await restrictedPool.query("SELECT current_user AS actor");
    expect(role.rows[0].actor).toBe("ink_story_review_executor");
    await expect(restrictedPool.query("SELECT email FROM users LIMIT 1")).rejects.toMatchObject({ code: "42501" });
  });
});
