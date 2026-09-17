// [Input] Runner-owned loopback PostgreSQL, Registry106 service and restricted SELECT-only DATA role.
// [Output] Thread/Deck ownership, enabled ref/order, adapter status/config and unchanged-row evidence.
// [Pos] Provider-free workspace plugin metadata contract; Dream filesystem packing is outside this harness.
// [Sync] 2026-09-15: prove one typed Drizzle read UOW without artifact bytes, paths or writes.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { AuthBoundaryError } from "../../app/lib/auth/config";
import { withDataTransaction } from "../../app/lib/dream/database";
import { deckWorkspacePluginsOperationContracts } from "../../app/lib/dream/deckWorkspacePluginsDto";
import {
  deckWorkspacePluginsSchemaRequirements,
  runDeckWorkspacePluginsOperation,
} from "../../app/lib/dream/deckWorkspacePluginsService";
import { startEmbeddedPostgres, type RunningEmbeddedPostgres } from "../../packages/db/src/embedded-postgres";

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve isolated port");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function expectFailure(action: () => Promise<unknown>, code: string, status: number): Promise<void> {
  let caught: unknown;
  try { await action(); } catch (error) { caught = error; }
  assert(caught instanceof AuthBoundaryError);
  assert.equal(caught.code, code);
  assert.equal(caught.status, status);
}

const suffix = randomBytes(6).toString("hex");
const database = `ink_auth_data_codex_test_workspace_plugins_${suffix}`;
const ownedRoot = await mkdtemp(join(tmpdir(), "ink-auth-data-workspace-plugins-"));
let embedded: RunningEmbeddedPostgres | undefined;
let pool: pg.Pool | undefined;
let evidence: Record<string, unknown> | undefined;
const oldPolicy = process.env.DREAM_WORKSPACE_PLUGIN_POLICY_JSON;

try {
  embedded = await startEmbeddedPostgres({
    mode: "embedded-postgres",
    dataDir: join(ownedRoot, "postgres"),
    port: await availablePort(),
    user: "postgres",
    password: `pg_${randomBytes(24).toString("base64url")}`,
    database,
    sharedBuffers: "24MB",
    maxConnections: 12,
  }, { listenAddresses: "127.0.0.1" });

  const setup = new pg.Client({ connectionString: embedded.connectionString });
  await setup.connect();
  try {
    await setup.query(`
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      CREATE SCHEMA drizzle;
      REVOKE ALL ON SCHEMA drizzle FROM PUBLIC;
      CREATE TABLE drizzle.schema_capabilities (
        capability text PRIMARY KEY,
        version integer NOT NULL,
        contract_sha256 text NOT NULL
      );
      CREATE TABLE decks (id text PRIMARY KEY, owner_id bigint);
      CREATE TABLE chat_thread (id text PRIMARY KEY, user_id bigint NOT NULL, deck_id text);
      CREATE TABLE claude_plugin_installations (
        id text PRIMARY KEY,
        package_name text NOT NULL,
        marketplace text NOT NULL,
        resolved_version text NOT NULL,
        artifact_digest text NOT NULL,
        status text NOT NULL,
        installed_at timestamptz,
        created_at timestamptz NOT NULL
      );
      CREATE TABLE deck_claude_plugin_refs (
        deck_id text NOT NULL,
        plugin_installation_id text NOT NULL,
        package_spec text NOT NULL,
        resolved_version text NOT NULL,
        artifact_digest text NOT NULL,
        enabled integer NOT NULL,
        order_index integer NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (deck_id, plugin_installation_id)
      );
      REVOKE ALL ON decks, chat_thread, claude_plugin_installations, deck_claude_plugin_refs FROM PUBLIC;
      REVOKE ALL ON drizzle.schema_capabilities FROM PUBLIC;
    `);
    const topology = await setup.query(
      "SELECT current_database() AS database, host(inet_server_addr()) AS address, current_setting('listen_addresses') AS listen",
    );
    assert.deepEqual(topology.rows[0], { database, address: "127.0.0.1", listen: "127.0.0.1" });

    const actorId = "9007199254740993";
    const digest = (character: string) => `sha256:${character.repeat(64)}`;
    await setup.query("INSERT INTO decks VALUES ('deck-owned',$1),('deck-foreign',7)", [actorId]);
    await setup.query("INSERT INTO chat_thread VALUES ('thread-owned',$1,'deck-owned'),('thread-unbound',$1,NULL),('thread-foreign',7,'deck-foreign'),('thread-bad-deck',$1,'deck-foreign')", [actorId]);
    await setup.query(`INSERT INTO claude_plugin_installations VALUES
      ('deck-ready','drama','official','1.2.3',$1,'ready','2026-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
      ('deck-error','pending','official','2.0.0',$2,'error','2026-01-02T00:00:00Z','2026-01-02T00:00:00Z'),
      ('deck-disabled','hidden','official','1.0.0',$3,'ready','2025-01-01T00:00:00Z','2025-01-01T00:00:00Z'),
      ('story-latest','story','platform','2.0.0',$4,'error','2026-03-01T00:00:00Z','2026-03-01T00:00:00Z'),
      ('story-ready','story','platform','1.0.0',$5,'ready','2026-02-01T00:00:00Z','2026-02-01T00:00:00Z')`,
      [digest("a"), digest("b"), digest("c"), digest("d"), digest("e")]);
    await setup.query(`INSERT INTO deck_claude_plugin_refs VALUES
      ('deck-owned','deck-error','pending@official','2.0.0',$1,1,2,'2026-01-02T00:00:00Z'),
      ('deck-owned','deck-ready','drama@official','1.2.3',$2,1,0,'2026-01-01T00:00:00Z'),
      ('deck-owned','deck-disabled','hidden@official','1.0.0',$3,0,-1,'2025-01-01T00:00:00Z')`,
      [digest("b"), digest("a"), digest("c")]);

    const role = `workspace_plugin_data_${suffix}`;
    const rolePassword = `rp_${randomBytes(24).toString("base64url")}`;
    await setup.query("CREATE ROLE " + role + " LOGIN PASSWORD '" + rolePassword + "'");
    await setup.query("GRANT USAGE ON SCHEMA public, drizzle TO " + role);
    await setup.query("GRANT SELECT ON decks, chat_thread, claude_plugin_installations, deck_claude_plugin_refs, drizzle.schema_capabilities TO " + role);
    const privilege = await setup.query(`SELECT
      has_schema_privilege($1, 'public', 'CREATE') AS public_create,
      has_table_privilege($1, 'public.chat_thread', 'SELECT') AS thread_select,
      has_table_privilege($1, 'public.decks', 'INSERT') AS deck_insert,
      has_table_privilege($1, 'public.deck_claude_plugin_refs', 'UPDATE') AS ref_update,
      has_table_privilege($1, 'public.claude_plugin_installations', 'DELETE') AS installation_delete,
      has_table_privilege($1, 'drizzle.schema_capabilities', 'SELECT') AS capability_select`, [role]);
    assert.deepEqual(privilege.rows[0], {
      public_create: false, thread_select: true, deck_insert: false,
      ref_update: false, installation_delete: false, capability_select: true,
    });

    const limitedUrl = new URL(embedded.connectionString);
    limitedUrl.username = role; limitedUrl.password = rolePassword;
    pool = new pg.Pool({ connectionString: limitedUrl.toString(), max: 4 });
    const db = drizzle(pool);
    assert.equal((await pool.query("SELECT current_user AS role")).rows[0].role, role);
    process.env.DREAM_WORKSPACE_PLUGIN_POLICY_JSON = JSON.stringify({
      story_workspace_adapter: { package_name: "story", marketplace: "platform", resolved_version: null },
    });

    const actor = (id = actorId, scopes: string[] = ["dream:read"], threadScope: string | null = null) => ({
      principal: { subject: "workspace-subject", canonical_user_id: id, client_id: "dream-browser", scopes, status: "active" as const },
      threadScope,
    });
    const execute = (input: unknown, current = actor()) => withDataTransaction(
      deckWorkspacePluginsSchemaRequirements,
      tx => runDeckWorkspacePluginsOperation("deck-workspace-plugins.resolve", input, current, tx),
      db,
    );

    await expectFailure(() => execute({ thread_id: "thread-owned", profile: "standard" }), "DREAM_DATA_SCHEMA_NOT_READY", 503);
    for (const requirement of deckWorkspacePluginsSchemaRequirements) {
      await setup.query(
        "INSERT INTO drizzle.schema_capabilities (capability,version,contract_sha256) VALUES ($1,$2,$3)",
        [requirement.capability, requirement.version, requirement.contractSha256],
      );
    }
    const before = await setup.query(`SELECT
      (SELECT count(*)::int FROM decks) AS decks,
      (SELECT count(*)::int FROM chat_thread) AS threads,
      (SELECT count(*)::int FROM claude_plugin_installations) AS installations,
      (SELECT count(*)::int FROM deck_claude_plugin_refs) AS refs,
      (SELECT count(*)::int FROM drizzle.schema_capabilities) AS capabilities`);

    const standard = await execute({ thread_id: "thread-owned", profile: "standard" });
    assert.equal(standard.deck_id, "deck-owned");
    assert.equal(standard.story_workspace_adapter, null);
    assert.deepEqual(standard.refs.map(item => [item.plugin_installation_id, item.order_index, item.installation_status]), [
      ["deck-ready", 0, "ready"], ["deck-error", 2, "error"],
    ]);
    assert(standard.refs.every(item => !Object.hasOwn(item, "artifact_path")));

    const story = await execute({ thread_id: "thread-owned", profile: "story_workspace" });
    assert.equal(story.story_workspace_adapter?.latest_status, "error");
    assert.deepEqual(story.story_workspace_adapter?.ready, {
      plugin_installation_id: "story-ready", package_spec: "story@platform",
      package_name: "story", marketplace: "platform", resolved_version: "1.0.0",
      artifact_digest: digest("e"), installation_status: "ready",
    });
    assert.deepEqual(await execute({ thread_id: "thread-unbound", profile: "story_workspace" }), {
      thread_id: "thread-unbound", deck_id: null, refs: [], story_workspace_adapter: null,
    });
    await expectFailure(() => execute({ thread_id: "thread-foreign", profile: "standard" }), "ENTITY_NOT_FOUND", 404);
    await expectFailure(() => execute({ thread_id: "thread-owned", profile: "standard" }, actor("7")), "ENTITY_NOT_FOUND", 404);
    await expectFailure(() => execute({ thread_id: "thread-bad-deck", profile: "standard" }), "DECK_ACCESS_DENIED", 404);
    await expectFailure(() => execute({ thread_id: "thread-owned", profile: "standard" }, actor(actorId, [])), "DREAM_SCOPE_REQUIRED", 403);
    await expectFailure(() => execute({ thread_id: "thread-owned", profile: "standard" }, actor(actorId, ["dream:read"], "thread-other")), "DREAM_DELEGATION_ENTITY_DENIED", 403);
    await expectFailure(() => execute({ thread_id: "thread-owned", profile: "custom" }), "INPUT_INVALID", 400);
    for (const key of ["actor_id", "user_id", "deck_id", "package_spec", "path", "sql", "table", "column"]) {
      assert.equal(deckWorkspacePluginsOperationContracts["deck-workspace-plugins.resolve"].input.safeParse({ thread_id: "thread-owned", profile: "standard", [key]: "external" }).success, false, `rejects ${key}`);
    }
    assert.deepEqual((await setup.query(`SELECT
      (SELECT count(*)::int FROM decks) AS decks,
      (SELECT count(*)::int FROM chat_thread) AS threads,
      (SELECT count(*)::int FROM claude_plugin_installations) AS installations,
      (SELECT count(*)::int FROM deck_claude_plugin_refs) AS refs,
      (SELECT count(*)::int FROM drizzle.schema_capabilities) AS capabilities`)).rows, before.rows);
    evidence = {
      result: "PASS", target: "runner-owned-named-disposable-postgresql",
      database_prefix: "ink_auth_data_codex_test_workspace_plugins_",
      listen_addresses: topology.rows[0].listen, server_address: topology.rows[0].address,
      restricted_data_role: true, owned_thread_and_deck: true,
      enabled_refs_and_status_order: true, configured_adapter_candidate_order: true,
      closed_selectors: true, scope_entity_and_capability_denied: true,
      one_read_operation: Object.keys(deckWorkspacePluginsOperationContracts).length,
      no_receipt_or_write: true, unchanged_row_counts: true,
    };
  } finally {
    await pool?.end();
    await setup.end();
  }
} finally {
  if (oldPolicy === undefined) delete process.env.DREAM_WORKSPACE_PLUGIN_POLICY_JSON;
  else process.env.DREAM_WORKSPACE_PLUGIN_POLICY_JSON = oldPolicy;
  await embedded?.stop().catch(() => undefined);
  await rm(ownedRoot, { recursive: true, force: true });
}

if (!evidence) throw new Error("Workspace plugin evidence was not produced");
console.log(JSON.stringify({ ...evidence, owned_cluster_removed: true }));
