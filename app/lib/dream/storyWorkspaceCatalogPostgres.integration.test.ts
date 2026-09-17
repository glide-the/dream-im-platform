// [Input] Named disposable PostgreSQL, restricted role, and Registry114 catalog DTO-Service-ORM path.
// [Output] Owner isolation, filters, relations, idempotency, rollback, default Workspace, and ACL evidence.
// [Pos] Isolated destructive catalog contract test; it never runs without dedicated harness URLs.
// [Sync] 2026-09-15: verify Story Workspace catalog business operations against real PostgreSQL.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { runStoryWorkspaceCatalogOperation } from "./storyWorkspaceCatalogService";

const adminUrl = process.env.STORY_WORKSPACE_CATALOG_TEST_ADMIN_URL;
const restrictedUrl = process.env.STORY_WORKSPACE_CATALOG_TEST_DATABASE_URL;
const enabled = Boolean(adminUrl && restrictedUrl);
const principal = (id: string) => ({ subject: `catalog-subject-${id}`, canonical_user_id: id,
  client_id: "dream-browser", scopes: ["dream:read", "dream:write"], status: "active" });

describe.skipIf(!enabled)("Story Workspace catalog PostgreSQL contract", () => {
  const admin = new pg.Pool({ connectionString: adminUrl, max: 2 });
  const restrictedPool = new pg.Pool({ connectionString: restrictedUrl, max: 4 });
  const database = drizzle(restrictedPool);

  beforeAll(async () => {
    const identity = await admin.query("SELECT current_database() AS database, current_user AS actor");
    expect(String(identity.rows[0].database)).toMatch(/^ink_story_workspace_catalog_test_[a-z0-9_]+$/);
    expect(String(identity.rows[0].actor)).toBe("postgres");
    await admin.query(`
      INSERT INTO users (id, email, password_hash) VALUES
        (1, 'catalog-one@example.invalid', 'fixture'),
        (2, 'catalog-two@example.invalid', 'fixture'),
        (3, 'catalog-three@example.invalid', 'fixture');
      INSERT INTO story_workspace_workspaces (id, name, owner_id, settings) VALUES
        ('workspace-1', 'Writer One', 1, '{"theme":"ink"}'),
        ('workspace-2', 'Writer Two', 2, '{}');
      INSERT INTO story_workspace_stories
        (id, identifier, title, description, status, review_status, type, content,
         author_id, workspace_id, agent_generated, character_count, scene_count,
         artifact_source_type, source_run_id, source_thread_ref, source_project_id,
         episode_count, artifact_status, artifact_manifest_revision, script_revision,
         artifact_sync_status, artifact_indexed_at, artifact_sync_error_code,
         script_size_bytes, reconcile_version)
      VALUES
        ('story-1', 'story-1', '午夜咖啡馆', '雨夜故事', 'draft', 'pending', 'short', 'private body',
         1, 'workspace-1', 1, 1, 1,
         'dream_episode', 'run-story-1', 'thread-story-1', 'project-story-1',
         1, 'available', 'sha256:' || repeat('a', 64), 'sha256:' || repeat('b', 64),
         'indexed', CURRENT_TIMESTAMP, NULL, 12, 1),
        ('story-2', 'story-2', '白昼书店', '日光故事', 'published', 'confirmed', 'long', 'private body',
         1, 'workspace-1', 1, 0, 0,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL),
        ('story-unsafe', 'story-unsafe', 'Unsafe', NULL, 'draft', 'pending', 'short', 'original',
         1, 'workspace-1', 1, 0, 0,
         'dream_episode', 'run-story-unsafe', 'thread-story-unsafe', 'project-story-unsafe',
         1, 'available', 'sha256:' || repeat('c', 64), 'sha256:' || repeat('d', 64),
         'indexed', CURRENT_TIMESTAMP, NULL, 9007199254740992, 1),
        ('story-foreign', 'story-foreign', '他人的故事', NULL, 'draft', 'pending', 'short', 'private',
         2, 'workspace-2', 1, 0, 0,
         NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);
      INSERT INTO story_workspace_characters
        (id, identifier, name, identity, personality, tags, author_id, workspace_id,
         story_count, review_status, agent_generated, status)
      VALUES
        ('character-1', 'character-1', '林小雨', '咖啡师', '温柔', '["温柔"]', 1, 'workspace-1', 1, 'pending', 1, 'active'),
        ('character-foreign', 'character-foreign', '他人角色', NULL, NULL, '[]', 2, 'workspace-2', 0, 'pending', 1, 'active');
      INSERT INTO story_workspace_scenes
        (id, identifier, name, description, story_id, author_id, workspace_id,
         character_count, order_index, review_status, agent_generated, status)
      VALUES
        ('scene-1', 'scene-1', '开场·雨夜', '雨中的咖啡馆', 'story-1', 1, 'workspace-1', 1, 1, 'pending', 1, 'active'),
        ('scene-foreign', 'scene-foreign', '秘密场景', NULL, 'story-foreign', 2, 'workspace-2', 0, 1, 'pending', 1, 'active');
      INSERT INTO story_workspace_story_characters (story_id, character_id, role_type)
        VALUES ('story-1', 'character-1', '主角');
      INSERT INTO story_workspace_scene_characters (scene_id, character_id)
        VALUES ('scene-1', 'character-1');
    `);
  });

  afterAll(async () => { await restrictedPool.end(); await admin.end(); });

  it("reads filtered owner-only pages and relation details with safe DTOs", async () => {
    const list = await database.transaction(tx => runStoryWorkspaceCatalogOperation(
      "story-workspace-catalog.read", { view: "story_list", q: "咖啡", review_status: ["pending"],
        status: ["draft"], type: ["short"], sort: "title", order: "asc", page: 1, per_page: 1 },
      principal("1"), "dream-service", "catalog-read-list", tx));
    if (!("view" in list) || list.view !== "story_list") throw new Error("Expected Story list");
    expect(list).toMatchObject({ pagination: { total: 1, total_pages: 1 }, data: [{
      id: "story-1", artifact_available: true }] });
    expect(list.data[0]).not.toHaveProperty("content"); expect(list.data[0]).not.toHaveProperty("author_id");

    const story = await database.transaction(tx => runStoryWorkspaceCatalogOperation(
      "story-workspace-catalog.read", { view: "story_detail", resource_id: "story-1" },
      principal("1"), "dream-service", "catalog-read-story", tx));
    if (!("view" in story) || story.view !== "story_detail") throw new Error("Expected Story detail");
    expect(story.item.characters).toMatchObject([{ id: "character-1", role_type: "主角", tags: ["温柔"] }]);
    expect(story.item.scenes).toMatchObject([{ id: "scene-1" }]);

    const scene = await database.transaction(tx => runStoryWorkspaceCatalogOperation(
      "story-workspace-catalog.read", { view: "scene_detail", resource_id: "scene-1" },
      principal("1"), "dream-service", "catalog-read-scene", tx));
    if (!("view" in scene) || scene.view !== "scene_detail") throw new Error("Expected Scene detail");
    expect(scene.item.story).toMatchObject({ id: "story-1" });
    expect(scene.item.characters).toMatchObject([{ id: "character-1" }]);
  });

  it("patches only owned allowed fields and replays the original receipt", async () => {
    const input = { resource_type: "character", resource_id: "character-1",
      patch: { identity: "夜班咖啡师", tags: ["温柔", "敏锐"] } } as const;
    const execute = () => database.transaction(tx => runStoryWorkspaceCatalogOperation(
      "story-workspace-catalog.patch", input, principal("1"), "dream-service", "catalog-patch", tx));
    const first = await execute(); const replay = await execute();
    expect(replay).toEqual(first); expect(first).toMatchObject({ resource_type: "character",
      item: { id: "character-1", identity: "夜班咖啡师", tags: ["温柔", "敏锐"] } });
    const evidence = await admin.query(`SELECT
      (SELECT count(*)::int FROM dream.operation_receipts WHERE request_id='catalog-patch') AS receipts,
      (SELECT count(*)::int FROM admin_audit_logs WHERE request_id='catalog-patch'
        AND action='dream.story-workspace-catalog.patch'
        AND resource_type='story_workspace_character') AS item_audits,
      (SELECT count(*)::int FROM admin_audit_logs WHERE request_id='catalog-patch'
        AND action='dream.story-workspace-catalog.patch'
        AND resource_type='dream_operation') AS operation_audits`);
    expect(evidence.rows[0]).toMatchObject({ receipts: 1, item_audits: 1, operation_audits: 1 });
  });

  it("creates one configured default Workspace under actor serialization", async () => {
    const ensure = () => database.transaction(tx => runStoryWorkspaceCatalogOperation(
      "story-workspace-catalog.workspace", { action: "ensure" }, principal("3"),
      "dream-service", "catalog-workspace", tx));
    const first = await ensure(); const replay = await ensure();
    expect(replay).toEqual(first); expect(first).toMatchObject({ action: "ensure", item: { name: "默认工作区" } });
    const count = await admin.query("SELECT count(*)::int AS total FROM story_workspace_workspaces WHERE owner_id=3");
    expect(count.rows[0].total).toBe(1);
  });

  it("denies cross-owner reads/patches and foreign Story reassignment", async () => {
    await expect(database.transaction(tx => runStoryWorkspaceCatalogOperation(
      "story-workspace-catalog.read", { view: "story_detail", resource_id: "story-foreign" },
      principal("1"), "dream-service", "catalog-foreign-read", tx)))
      .rejects.toMatchObject({ code: "STORY_WORKSPACE_CATALOG_NOT_FOUND", status: 404 });
    await expect(database.transaction(tx => runStoryWorkspaceCatalogOperation(
      "story-workspace-catalog.patch", { resource_type: "story", resource_id: "story-foreign",
        patch: { title: "stolen" } }, principal("1"), "dream-service", "catalog-foreign-patch", tx)))
      .rejects.toMatchObject({ code: "STORY_WORKSPACE_CATALOG_NOT_FOUND", status: 404 });
    await expect(database.transaction(tx => runStoryWorkspaceCatalogOperation(
      "story-workspace-catalog.patch", { resource_type: "scene", resource_id: "scene-1",
        patch: { story_id: "story-foreign" } }, principal("1"), "dream-service", "catalog-foreign-link", tx)))
      .rejects.toMatchObject({ code: "STORY_WORKSPACE_CATALOG_NOT_FOUND", status: 404 });
  });

  it("rolls back a mutation, receipt, and audit when its public DTO is invalid", async () => {
    await expect(database.transaction(tx => runStoryWorkspaceCatalogOperation(
      "story-workspace-catalog.patch", { resource_type: "story", resource_id: "story-unsafe",
        patch: { title: "Should roll back" } }, principal("1"), "dream-service", "catalog-unsafe", tx)))
      .rejects.toBeTruthy();
    const evidence = await admin.query(`SELECT
      (SELECT title FROM story_workspace_stories WHERE id='story-unsafe') AS title,
      (SELECT count(*)::int FROM dream.operation_receipts WHERE request_id='catalog-unsafe') AS receipts,
      (SELECT count(*)::int FROM admin_audit_logs WHERE request_id='catalog-unsafe') AS audits`);
    expect(evidence.rows[0]).toMatchObject({ title: "Unsafe", receipts: 0, audits: 0 });
  });

  it("uses a role without direct users or unrelated Admin table access", async () => {
    expect((await restrictedPool.query("SELECT current_user AS actor")).rows[0].actor)
      .toBe("ink_story_catalog_executor");
    await expect(restrictedPool.query("SELECT email FROM users LIMIT 1"))
      .rejects.toMatchObject({ code: "42501" });
  });
});
