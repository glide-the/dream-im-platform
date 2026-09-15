// [Input] Runner-owned named loopback PostgreSQL and Registry109 production DTO-Service-Drizzle modules.
// [Output] Concurrent graph reuse, reconciliation, restricted-role writes, receipt/audit and full rollback evidence.
// [Pos] Provider-free Story output persistence contract; no normal database, Runtime, provider or filesystem content.
// [Sync] 2026-09-15: prove standalone Story proposal persistence is one Admin-owned UOW.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { startEmbeddedPostgres, type RunningEmbeddedPostgres } from "../../packages/db/src/embedded-postgres";
import type { DataTransaction } from "../../app/lib/dream/database";
import { runStoryWorkspaceOutputOperation } from "../../app/lib/dream/storyWorkspaceOutputService";

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Unable to reserve isolated port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

const suffix = randomBytes(6).toString("hex");
const database = `ink_auth_data_codex_test_story_output109_${suffix}`;
const ownedRoot = await mkdtemp(join(tmpdir(), "ink-auth-data-story-output-"));
let embedded: RunningEmbeddedPostgres | undefined;
let pool: pg.Pool | undefined;
let evidence: Record<string, unknown> | undefined;
let assertions = 0;
const check = (condition: unknown, message: string) => { assert(condition, message); assertions++; };
const equal = (actual: unknown, expected: unknown, message: string) => { assert.deepEqual(actual, expected, message); assertions++; };

try {
  embedded = await startEmbeddedPostgres({ mode: "embedded-postgres", dataDir: join(ownedRoot, "postgres"),
    port: await availablePort(), user: "postgres", password: `pg_${randomBytes(24).toString("base64url")}`,
    database, sharedBuffers: "24MB", maxConnections: 14 }, { listenAddresses: "127.0.0.1" });
  const setup = new pg.Client({ connectionString: embedded.connectionString }); await setup.connect();
  try {
    await setup.query(`
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      CREATE SCHEMA dream; REVOKE ALL ON SCHEMA dream FROM PUBLIC;
      CREATE TABLE users (
        id bigint PRIMARY KEY, email text NOT NULL UNIQUE, password_hash text NOT NULL,
        display_name text, avatar_url text, role text NOT NULL DEFAULT 'user', status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE story_workspace_workspaces (
        id text PRIMARY KEY, name text NOT NULL, owner_id bigint NOT NULL REFERENCES users(id),
        settings jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL DEFAULT 'active',
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE story_workspace_stories (
        id text PRIMARY KEY, identifier text NOT NULL, title text NOT NULL, description text,
        status text NOT NULL DEFAULT 'draft', review_status text NOT NULL DEFAULT 'pending', type text NOT NULL DEFAULT 'short',
        content text, author_id bigint NOT NULL REFERENCES users(id), workspace_id text NOT NULL REFERENCES story_workspace_workspaces(id),
        character_count integer NOT NULL DEFAULT 0, scene_count integer NOT NULL DEFAULT 0,
        agent_generated integer NOT NULL DEFAULT 1, agent_session_id text, review_notes text,
        artifact_source_type text, source_run_id text, source_thread_ref text, source_project_id text,
        episode_count integer, artifact_status text, artifact_manifest_revision text, script_revision text,
        artifact_sync_status text, artifact_indexed_at timestamptz, artifact_sync_error_code text,
        script_size_bytes bigint, reconcile_version integer, reviewed_script_revision text,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        confirmed_at timestamptz, published_at timestamptz
      );
      CREATE TABLE story_workspace_characters (
        id text PRIMARY KEY, identifier text NOT NULL, name text NOT NULL, avatar_url text, identity text,
        personality text, background text, catchphrase text, tags text DEFAULT '[]', notes text,
        author_id bigint NOT NULL REFERENCES users(id), workspace_id text NOT NULL REFERENCES story_workspace_workspaces(id),
        story_count integer NOT NULL DEFAULT 0, review_status text NOT NULL DEFAULT 'pending',
        agent_generated integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(), status text NOT NULL DEFAULT 'active', review_notes text,
        confirmed_at timestamptz, archived_at timestamptz
      );
      CREATE TABLE story_workspace_scenes (
        id text PRIMARY KEY, identifier text NOT NULL, name text NOT NULL, description text, story_id text REFERENCES story_workspace_stories(id),
        author_id bigint NOT NULL REFERENCES users(id), workspace_id text NOT NULL REFERENCES story_workspace_workspaces(id),
        character_count integer NOT NULL DEFAULT 0, order_index integer NOT NULL DEFAULT 0,
        review_status text NOT NULL DEFAULT 'pending', agent_generated integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
        status text NOT NULL DEFAULT 'active', review_notes text, confirmed_at timestamptz, archived_at timestamptz
      );
      CREATE TABLE story_workspace_story_characters (
        story_id text NOT NULL REFERENCES story_workspace_stories(id), character_id text NOT NULL REFERENCES story_workspace_characters(id),
        role_type text, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(story_id, character_id)
      );
      CREATE TABLE story_workspace_scene_characters (
        scene_id text NOT NULL REFERENCES story_workspace_scenes(id), character_id text NOT NULL REFERENCES story_workspace_characters(id),
        created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(scene_id, character_id)
      );
      CREATE TABLE decks (
        id text PRIMARY KEY, name text NOT NULL, name_zh text, name_en text, description text, description_zh text,
        description_en text, icon text, color text, is_system boolean DEFAULT false, parent_id text,
        owner_id bigint REFERENCES users(id), enabled boolean DEFAULT true, has_local_changes boolean DEFAULT false,
        order_index integer, published boolean DEFAULT false, author_name text, install_count integer DEFAULT 0,
        draft_revision integer NOT NULL DEFAULT 1, latest_version integer NOT NULL DEFAULT 0,
        published_draft_revision integer NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE chat_thread (
        id text PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id), title text, deck_id text REFERENCES decks(id),
        voice_id text, claude_session_id text, agent_contract_version text,
        created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
      );
      CREATE TABLE dream.operation_receipts (
        service_client_id text NOT NULL, actor text NOT NULL, operation text NOT NULL, request_id text NOT NULL,
        input_sha256 text NOT NULL, result jsonb NOT NULL, committed_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY(service_client_id, actor, operation, request_id)
      );
      CREATE TABLE admin_audit_logs (
        id text PRIMARY KEY, actor_type text NOT NULL, actor_id text, action text NOT NULL, resource_type text NOT NULL,
        resource_id text, request_id text NOT NULL, ip_address text, user_agent text, before jsonb, after jsonb,
        metadata jsonb DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(request_id, action, resource_type, resource_id)
      );
      REVOKE ALL ON ALL TABLES IN SCHEMA public, dream FROM PUBLIC;
    `);
    const topology = (await setup.query("SELECT current_database() AS database,host(inet_server_addr()) AS address,current_setting('listen_addresses') AS listen")).rows[0];
    equal(topology, { database, address: "127.0.0.1", listen: "127.0.0.1" }, "Named loopback target required");
    const actorId = "8600000000000001", threadId = `thread-${suffix}`, deckId = `deck-${suffix}`;
    await setup.query("INSERT INTO users(id,email,password_hash) VALUES($1,$2,'fixture')", [actorId, `registry109-${suffix}@example.invalid`]);
    await setup.query("INSERT INTO decks(id,name,name_zh,name_en,owner_id) VALUES($1,'Dream','梦','Dream',$2)", [deckId, actorId]);
    await setup.query("INSERT INTO chat_thread(id,user_id,deck_id) VALUES($1,$2,$3)", [threadId, actorId, deckId]);
    const role = `story_output_data_${suffix}`, password = `rp_${randomBytes(24).toString("base64url")}`;
    await setup.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    await setup.query(`GRANT USAGE ON SCHEMA public,dream TO ${role}`);
    await setup.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON users,story_workspace_workspaces,story_workspace_stories,
      story_workspace_characters,story_workspace_scenes,story_workspace_story_characters,
      story_workspace_scene_characters,decks,chat_thread,admin_audit_logs,dream.operation_receipts TO ${role}`);
    const rights = (await setup.query(`SELECT has_schema_privilege($1,'public','CREATE') AS public_create,
      has_table_privilege($1,'public.story_workspace_stories','INSERT') AS story_insert,
      has_table_privilege($1,'public.chat_thread','DELETE') AS thread_delete,
      has_table_privilege($1,'dream.operation_receipts','INSERT') AS receipt_insert`, [role])).rows[0];
    equal(rights, { public_create: false, story_insert: true, thread_delete: true, receipt_insert: true }, "Restricted role rights mismatch");
    const limitedUrl = new URL(embedded.connectionString); limitedUrl.username = role; limitedUrl.password = password;
    pool = new pg.Pool({ connectionString: limitedUrl.toString(), max: 6 }); const db = drizzle(pool);
    const actor = { principal: { subject: `subject-${suffix}`, canonical_user_id: actorId, client_id: "dream-integration",
      scopes: ["dream:read", "dream:write"], status: "active" as const }, threadScope: null, runScope: null };
    const service = `service-${suffix}`;
    const input = { thread_id: threadId, story: { title: `午夜咖啡馆-${suffix}`, description: "雨夜故事", type: "script" as const,
      content: "# 第一幕", characters: [
        { name: "林小雨", identity: "咖啡师", personality: "温柔", background: null, catchphrase: null, tags: ["温柔"] },
        { name: "周晴", identity: "店主", personality: null, background: null, catchphrase: null, tags: [] },
      ], scenes: [{ name: "雨夜", description: "开场", order_index: 0 }, { name: "清晨", description: "结尾", order_index: 1 }] } };
    const execute = (value: unknown, requestId: string) => db.transaction(tx => runStoryWorkspaceOutputOperation(
      "story-workspace-output.store", value, actor, service, requestId, tx as DataTransaction));
    const [first, second] = await Promise.all([execute(input, `request-a-${suffix}`), execute(input, `request-b-${suffix}`)]);
    equal(first, second, "Concurrent different requests must reuse one Story graph");
    check(first.chat_thread_id === threadId && first.deck_id === deckId && first.deck_name_zh === "梦", "Thread/Deck projection mismatch");
    const initial = (await setup.query(`SELECT
      (SELECT count(*)::int FROM story_workspace_workspaces WHERE owner_id=$1) AS workspaces,
      (SELECT count(*)::int FROM story_workspace_stories WHERE author_id=$1 AND agent_session_id=$2) AS stories,
      (SELECT count(*)::int FROM story_workspace_characters WHERE author_id=$1) AS characters,
      (SELECT count(*)::int FROM story_workspace_scenes WHERE author_id=$1) AS scenes,
      (SELECT count(*)::int FROM story_workspace_story_characters WHERE story_id=$3) AS story_characters,
      (SELECT count(*)::int FROM story_workspace_scene_characters WHERE scene_id=ANY($4::text[])) AS scene_characters,
      (SELECT count(*)::int FROM dream.operation_receipts WHERE actor=$5 AND operation='story-workspace-output.store') AS receipts,
      (SELECT count(*)::int FROM admin_audit_logs WHERE actor_id=$6 AND action='dream.story-workspace-output.store') AS audits`,
      [actorId, threadId, first.story_id, first.scene_ids, actor.principal.subject, service])).rows[0];
    equal(initial, { workspaces: 1, stories: 1, characters: 2, scenes: 2, story_characters: 2,
      scene_characters: 4, receipts: 2, audits: 2 }, "Concurrent graph counts mismatch");

    const updated = { ...input, story: { ...input.story, description: "第二次生成",
      characters: [{ ...input.story.characters[0], personality: "冷静" }],
      scenes: [{ ...input.story.scenes[0], description: "更新后的开场" }] } };
    const third = await execute(updated, `request-c-${suffix}`);
    check(third.story_id === first.story_id && third.character_ids[0] === first.character_ids[0]
      && third.scene_ids[0] === first.scene_ids[0], "Stable Story/Character/Scene identities must be reused");
    const reconciled = (await setup.query(`SELECT
      (SELECT to_jsonb(s) FROM story_workspace_stories s WHERE id=$1) AS story,
      (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.name),'[]') FROM story_workspace_characters c WHERE c.author_id=$2) AS characters,
      (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.order_index),'[]') FROM story_workspace_scenes s WHERE s.story_id=$1) AS scenes,
      (SELECT count(*)::int FROM story_workspace_story_characters WHERE story_id=$1) AS story_characters,
      (SELECT count(*)::int FROM story_workspace_scene_characters WHERE scene_id=$3) AS scene_characters`,
      [first.story_id, actorId, third.scene_ids[0]])).rows[0];
    check(reconciled.story.description === "第二次生成" && reconciled.story.character_count === 1
      && reconciled.story.scene_count === 1, "Story update/count projection mismatch");
    check(reconciled.characters.length === 2 && reconciled.characters.find((row: Record<string, unknown>) => row.id === third.character_ids[0])?.story_count === 1
      && reconciled.characters.find((row: Record<string, unknown>) => row.id !== third.character_ids[0])?.story_count === 0, "Character count reconciliation mismatch");
    check(reconciled.scenes.length === 1 && reconciled.scenes[0].description === "更新后的开场"
      && reconciled.story_characters === 1 && reconciled.scene_characters === 1, "Stale Scene/relation cleanup mismatch");

    const faultTitle = `回滚故事-${suffix}`, faultRequest = `request-fault-${suffix}`;
    await assert.rejects(() => db.transaction(async tx => {
      await runStoryWorkspaceOutputOperation("story-workspace-output.store", { ...input, story: { ...input.story, title: faultTitle } },
        actor, service, faultRequest, tx as DataTransaction);
      throw new Error("injected late transaction failure");
    }), /injected late transaction failure/); assertions++;
    const rollback = (await setup.query(`SELECT
      (SELECT count(*)::int FROM story_workspace_stories WHERE title=$1) AS stories,
      (SELECT count(*)::int FROM dream.operation_receipts WHERE request_id=$2) AS receipts,
      (SELECT count(*)::int FROM admin_audit_logs WHERE request_id=$2) AS audits`, [faultTitle, faultRequest])).rows[0];
    equal(rollback, { stories: 0, receipts: 0, audits: 0 }, "Late fault must roll back the full UOW");
    await assert.rejects(() => execute({ ...input, workspace_id: "caller" }, `request-invalid-${suffix}`),
      (error: unknown) => Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === "INPUT_INVALID")); assertions++;
    const invalid = (await setup.query("SELECT count(*)::int AS receipts FROM dream.operation_receipts WHERE request_id=$1", [`request-invalid-${suffix}`])).rows[0];
    equal(invalid, { receipts: 0 }, "Closed selector cannot create a receipt");

    evidence = { result: "PASS", operation: "story-workspace-output.store", assertions,
      database_prefix: "ink_auth_data_codex_test_story_output109_", loopback_only: true,
      restricted_data_role: true, concurrent_requests: 2, single_story_graph: true,
      stable_identity_reconciliation: true, late_fault_full_rollback: true,
      dto_orm_uow: true, normal_database: "untouched" };
  } finally { await pool?.end(); await setup.end(); }
} finally {
  await embedded?.stop().catch(() => undefined);
  await rm(ownedRoot, { recursive: true, force: true });
}
if (!evidence) throw new Error("Registry109 evidence was not produced");
console.log(JSON.stringify({ ...evidence, owned_cluster_removed: true }));
