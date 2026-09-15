// [Input] Runner-owned loopback PostgreSQL, Registry105 service and restricted read-only DATA role.
// [Output] Ownership/filter/order/error/capability results with unchanged rows and owned-cluster cleanup.
// [Pos] Provider-free Deck chat-context contract; it never connects to configured application databases.
// [Sync] 2026-09-15: verify one typed Drizzle UOW over Deck, Voice, ref and installation facts.
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
import { deckChatContextOperationContracts } from "../../app/lib/dream/deckChatContextDto";
import {
  deckChatContextSchemaRequirements,
  runDeckChatContextOperation,
} from "../../app/lib/dream/deckChatContextService";
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
const database = `ink_auth_data_codex_test_deck_chat_context_${suffix}`;
const ownedRoot = await mkdtemp(join(tmpdir(), "ink-auth-data-deck-chat-context-"));
let embedded: RunningEmbeddedPostgres | undefined;
let pool: pg.Pool | undefined;
let evidence: Record<string, unknown> | undefined;

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
      CREATE TABLE decks (
        id text PRIMARY KEY,
        name text NOT NULL,
        name_zh text,
        name_en text,
        description text,
        description_zh text,
        description_en text,
        owner_id bigint,
        enabled boolean
      );
      CREATE TABLE voices (
        id text PRIMARY KEY,
        deck_id text NOT NULL,
        name text NOT NULL,
        name_zh text,
        name_en text,
        system_prompt text NOT NULL,
        enabled boolean,
        order_index integer,
        created_at timestamptz
      );
      CREATE TABLE claude_plugin_installations (
        id text PRIMARY KEY,
        status text NOT NULL
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
      REVOKE ALL ON decks, voices, claude_plugin_installations, deck_claude_plugin_refs FROM PUBLIC;
      REVOKE ALL ON drizzle.schema_capabilities FROM PUBLIC;
    `);
    const topology = await setup.query(
      "SELECT current_database() AS database, host(inet_server_addr()) AS address, current_setting('listen_addresses') AS listen",
    );
    assert.deepEqual(topology.rows[0], { database, address: "127.0.0.1", listen: "127.0.0.1" });

    const actorId = "9007199254740993";
    await setup.query(`INSERT INTO decks VALUES
      ('deck-owned','创作组','创作组',NULL,'说明',NULL,'Description',$1,true),
      ('deck-disabled','Disabled',NULL,NULL,NULL,NULL,NULL,$1,false),
      ('deck-foreign','Foreign',NULL,NULL,NULL,NULL,NULL,7,true)`, [actorId]);
    await setup.query(`INSERT INTO voices VALUES
        ('voice-z','deck-owned','Zed',NULL,NULL,'Z prompt',true,2,'2026-02-01T00:00:00Z'),
        ('voice-b','deck-owned','Beta',NULL,NULL,'Beta prompt',true,1,'2026-01-01T00:00:00Z'),
        ('voice-a','deck-owned','Alpha','阿尔法',NULL,'Alpha 😀',true,1,'2026-01-01T00:00:00Z'),
        ('voice-disabled','deck-owned','Hidden',NULL,NULL,'hidden',false,0,'2025-01-01T00:00:00Z'),
        ('voice-other','deck-foreign','Other',NULL,NULL,'other',true,0,'2025-01-01T00:00:00Z')`);
    await setup.query(`INSERT INTO claude_plugin_installations VALUES
      ('install-ready','ready'),('install-error','error'),('install-disabled','ready')`);
    await setup.query(`INSERT INTO deck_claude_plugin_refs VALUES
        ('deck-owned','install-error','pending@official','2.0.0',$1,1,2,'2026-01-02T00:00:00Z'),
        ('deck-owned','install-ready','drama-forge@official','1.2.3',$2,1,0,'2026-01-01T00:00:00Z'),
        ('deck-owned','install-disabled','hidden@official','1.0.0',$3,0,-1,'2025-01-01T00:00:00Z')`,
      [`sha256:${"b".repeat(64)}`, `sha256:${"a".repeat(64)}`, `sha256:${"c".repeat(64)}`]);

    const role = `deck_chat_context_data_${suffix}`;
    const rolePassword = `rp_${randomBytes(24).toString("base64url")}`;
    await setup.query("CREATE ROLE " + role + " LOGIN PASSWORD '" + rolePassword + "'");
    await setup.query("GRANT USAGE ON SCHEMA public, drizzle TO " + role);
    await setup.query("GRANT SELECT ON decks, voices, claude_plugin_installations, deck_claude_plugin_refs, drizzle.schema_capabilities TO " + role);
    const privilege = await setup.query(`
      SELECT
        has_schema_privilege($1, 'public', 'CREATE') AS public_create,
        has_table_privilege($1, 'public.decks', 'SELECT') AS deck_select,
        has_table_privilege($1, 'public.decks', 'INSERT') AS deck_insert,
        has_table_privilege($1, 'public.voices', 'UPDATE') AS voice_update,
        has_table_privilege($1, 'public.deck_claude_plugin_refs', 'DELETE') AS ref_delete,
        has_table_privilege($1, 'drizzle.schema_capabilities', 'SELECT') AS capability_select
    `, [role]);
    assert.deepEqual(privilege.rows[0], {
      public_create: false, deck_select: true, deck_insert: false,
      voice_update: false, ref_delete: false, capability_select: true,
    });

    const limitedUrl = new URL(embedded.connectionString);
    limitedUrl.username = role;
    limitedUrl.password = rolePassword;
    pool = new pg.Pool({ connectionString: limitedUrl.toString(), max: 4 });
    const db = drizzle(pool);
    assert.equal((await pool.query("SELECT current_user AS role")).rows[0].role, role);

    const actor = (id = actorId, scopes: string[] = ["dream:read"], threadScope: string | null = null) => ({
      principal: { subject: "context-subject", canonical_user_id: id, client_id: "dream-browser", scopes, status: "active" as const },
      threadScope,
    });
    const execute = (input: unknown, current = actor()) => withDataTransaction(
      deckChatContextSchemaRequirements,
      tx => runDeckChatContextOperation("deck-chat-context.resolve", input, current, tx),
      db,
    );

    await expectFailure(() => execute({ deck_id: "deck-owned", voice_id: null }), "DREAM_DATA_SCHEMA_NOT_READY", 503);
    for (const requirement of deckChatContextSchemaRequirements) {
      await setup.query(
        "INSERT INTO drizzle.schema_capabilities (capability,version,contract_sha256) VALUES ($1,$2,$3)",
        [requirement.capability, requirement.version, requirement.contractSha256],
      );
    }
    const before = await setup.query(`SELECT
      (SELECT count(*)::int FROM decks) AS decks,
      (SELECT count(*)::int FROM voices) AS voices,
      (SELECT count(*)::int FROM claude_plugin_installations) AS installations,
      (SELECT count(*)::int FROM deck_claude_plugin_refs) AS refs,
      (SELECT count(*)::int FROM drizzle.schema_capabilities) AS capabilities`);

    const all = await execute({ deck_id: "deck-owned", voice_id: null });
    assert.deepEqual(all.deck, {
      id: "deck-owned", name: "创作组", name_zh: "创作组", name_en: null,
      description: "说明", description_zh: null, description_en: "Description",
    });
    assert.deepEqual(all.voices.map(item => item.id), ["voice-a", "voice-b", "voice-z"]);
    assert.equal(all.voices[0]?.system_prompt, "Alpha 😀");
    assert.deepEqual(all.plugin_refs.map(item => [item.plugin_installation_id, item.installation_status]), [
      ["install-ready", "ready"], ["install-error", "error"],
    ]);
    const selected = await execute({ deck_id: "deck-owned", voice_id: "voice-b" });
    assert.deepEqual(selected.voices.map(item => item.id), ["voice-b"]);

    await expectFailure(() => execute({ deck_id: "deck-foreign", voice_id: null }), "DECK_ACCESS_DENIED", 404);
    await expectFailure(() => execute({ deck_id: "deck-owned", voice_id: null }, actor("7")), "DECK_ACCESS_DENIED", 404);
    await expectFailure(() => execute({ deck_id: "deck-disabled", voice_id: null }), "DECK_DISABLED", 409);
    await expectFailure(() => execute({ deck_id: "deck-owned", voice_id: "voice-disabled" }), "AGENT_ACCESS_DENIED", 404);
    await expectFailure(() => execute({ deck_id: "deck-owned", voice_id: "voice-other" }), "AGENT_ACCESS_DENIED", 404);
    await expectFailure(() => execute({ deck_id: "deck-owned", voice_id: "missing" }), "AGENT_ACCESS_DENIED", 404);
    await expectFailure(() => execute({ deck_id: "deck-owned" }), "INPUT_INVALID", 400);
    await expectFailure(() => execute({ deck_id: "deck-owned", voice_id: null, actor_id: actorId }), "INPUT_INVALID", 400);
    await expectFailure(() => execute({ deck_id: "deck-owned", voice_id: null }, actor(actorId, [])), "DREAM_SCOPE_REQUIRED", 403);
    await expectFailure(() => execute({ deck_id: "deck-owned", voice_id: null }, actor(actorId, ["dream:read"], "thread-1")), "DREAM_DELEGATION_ENTITY_DENIED", 403);
    for (const key of ["actor_id", "user_id", "thread_id", "prompt_mode", "dream_mode", "path", "sql", "table", "column"]) {
      assert.equal(deckChatContextOperationContracts["deck-chat-context.resolve"].input.safeParse({ deck_id: "deck-owned", voice_id: null, [key]: "external" }).success, false, `rejects ${key}`);
    }
    assert.deepEqual((await setup.query(`SELECT
      (SELECT count(*)::int FROM decks) AS decks,
      (SELECT count(*)::int FROM voices) AS voices,
      (SELECT count(*)::int FROM claude_plugin_installations) AS installations,
      (SELECT count(*)::int FROM deck_claude_plugin_refs) AS refs,
      (SELECT count(*)::int FROM drizzle.schema_capabilities) AS capabilities`)).rows, before.rows);
    evidence = {
      result: "PASS",
      target: "runner-owned-named-disposable-postgresql",
      database_prefix: "ink_auth_data_codex_test_deck_chat_context_",
      listen_addresses: topology.rows[0].listen,
      server_address: topology.rows[0].address,
      restricted_data_role: true,
      owned_enabled_deck: true,
      selected_and_all_voice_order: true,
      enabled_ref_order_and_nonready_status: true,
      closed_selectors: true,
      scope_entity_and_capability_denied: true,
      one_read_operation: Object.keys(deckChatContextOperationContracts).length,
      no_receipt_or_write: true,
      unchanged_row_counts: true,
    };
  } finally {
    await pool?.end();
    await setup.end();
  }
} finally {
  await embedded?.stop().catch(() => undefined);
  await rm(ownedRoot, { recursive: true, force: true });
}

if (!evidence) throw new Error("Deck chat-context evidence was not produced");
console.log(JSON.stringify({ ...evidence, owned_cluster_removed: true }));
