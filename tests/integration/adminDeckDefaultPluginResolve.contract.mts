// [Input] Runner-owned loopback PostgreSQL, Registry104 resolve service and server-owned Deck policy.
// [Output] Exact ready candidate, stable duplicate ordering, closed inputs, capability/scope gates and cleanup evidence.
// [Pos] Provider-free default-plugin read contract; it never connects to configured application databases.
// [Sync] 2026-09-15: preserve raw compatibility JSON and newest ready package/version resolution.
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
import {
  deckDefaultPluginResolveSchemaRequirements,
  runDeckDefaultPluginResolveOperation,
} from "../../app/lib/dream/deckDefaultPluginResolveService";
import { deckDefaultPluginResolveOperationContracts } from "../../app/lib/dream/deckDefaultPluginResolveDto";
import type { DeckVoicePolicyDto } from "../../app/lib/dream/deckVoiceDto";
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

async function expectAuthFailure(action: () => Promise<unknown>, code: string, status: number): Promise<void> {
  let caught: unknown;
  try { await action(); } catch (error) { caught = error; }
  assert(caught instanceof AuthBoundaryError);
  assert.equal(caught.code, code);
  assert.equal(caught.status, status);
}

const suffix = randomBytes(6).toString("hex");
const database = `ink_auth_data_codex_test_deck_default_plugin_${suffix}`;
const ownedRoot = await mkdtemp(join(tmpdir(), "ink-auth-data-deck-default-plugin-"));
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
      CREATE TABLE claude_plugin_installations (
        id text PRIMARY KEY,
        package_name text NOT NULL,
        marketplace text NOT NULL,
        resolved_version text NOT NULL,
        artifact_digest text NOT NULL,
        compatibility_json text NOT NULL,
        status text NOT NULL,
        created_at timestamptz NOT NULL
      );
      REVOKE ALL ON claude_plugin_installations FROM PUBLIC;
      REVOKE ALL ON drizzle.schema_capabilities FROM PUBLIC;
    `);
    const topology = await setup.query(
      "SELECT current_database() AS database, host(inet_server_addr()) AS address, current_setting('listen_addresses') AS listen",
    );
    assert.deepEqual(topology.rows[0], { database, address: "127.0.0.1", listen: "127.0.0.1" });

    const packageName = "platform.default-plugin";
    const version = "1.2.3";
    const digestA = `sha256:${"a".repeat(64)}`;
    const digestZ = `sha256:${"f".repeat(64)}`;
    const exactRows = [
      ["install-old", packageName, "official", version, `sha256:${"0".repeat(64)}`, '{"legacy":true}', "ready", "2026-01-01T00:00:00Z"],
      ["install-tie-a", packageName, "official", version, digestA, '{"raw":true,"n":9007199254740993}', "ready", "2026-02-01T00:00:00Z"],
      ["install-tie-z", packageName, "official", version, digestZ, '{"raw":false,"n":9007199254740993}', "ready", "2026-02-01T00:00:00Z"],
      ["install-error", "unready-plugin", "official", "9.9.9", `sha256:${"e".repeat(64)}`, '{"error":true}', "error", "2026-03-01T00:00:00Z"],
      ["install-mismatch-version", packageName, "official", "9.9.9", `sha256:${"b".repeat(64)}`, '{"mismatch":"version"}', "ready", "2026-04-01T00:00:00Z"],
      ["install-mismatch-package", "other-plugin", "official", version, `sha256:${"c".repeat(64)}`, '{"mismatch":"package"}', "ready", "2026-04-01T00:00:00Z"],
    ] as const;
    for (const row of exactRows) {
      await setup.query(
        "INSERT INTO claude_plugin_installations (id,package_name,marketplace,resolved_version,artifact_digest,compatibility_json,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        row,
      );
    }

    const role = `deck_default_plugin_data_${suffix}`;
    const rolePassword = `rp_${randomBytes(24).toString("base64url")}`;
    await setup.query("CREATE ROLE " + role + " LOGIN PASSWORD '" + rolePassword + "'");
    await setup.query("GRANT USAGE ON SCHEMA public, drizzle TO " + role);
    await setup.query("GRANT SELECT ON claude_plugin_installations, drizzle.schema_capabilities TO " + role);
    const privilege = await setup.query(`
      SELECT
        has_schema_privilege($1, 'public', 'USAGE') AS public_usage,
        has_schema_privilege($1, 'public', 'CREATE') AS public_create,
        has_schema_privilege($1, 'drizzle', 'USAGE') AS drizzle_usage,
        has_table_privilege($1, 'public.claude_plugin_installations', 'SELECT') AS installation_select,
        has_table_privilege($1, 'public.claude_plugin_installations', 'INSERT') AS installation_insert,
        has_table_privilege($1, 'public.claude_plugin_installations', 'UPDATE') AS installation_update,
        has_table_privilege($1, 'public.claude_plugin_installations', 'DELETE') AS installation_delete,
        has_table_privilege($1, 'drizzle.schema_capabilities', 'SELECT') AS capability_select
    `, [role]);
    assert.deepEqual(privilege.rows[0], {
      public_usage: true, public_create: false, drizzle_usage: true,
      installation_select: true, installation_insert: false, installation_update: false, installation_delete: false,
      capability_select: true,
    });

    const limitedUrl = new URL(embedded.connectionString);
    limitedUrl.username = role;
    limitedUrl.password = rolePassword;
    pool = new pg.Pool({ connectionString: limitedUrl.toString(), max: 4 });
    const db = drizzle(pool);
    assert.equal((await pool.query("SELECT current_user AS role")).rows[0].role, role);

    const policy = {
      default_system_deck_id: "system-default",
      retired_system_deck_ids: [],
      default_plugin_package_name: packageName,
      default_plugin_version: version,
      default_memory_workspace_config_json: "{}",
      template: {
        name: "Default", name_zh: null, name_en: null, description: null,
        description_zh: null, description_en: null, icon: null, color: null, voices: [],
      },
    } satisfies DeckVoicePolicyDto;
    const actor = (scopes: string[] = ["dream:read"], threadScope: string | null = null) => ({
      principal: {
        subject: "deck-default-plugin-subject", canonical_user_id: "9007199254740993",
        client_id: "dream-browser", scopes, status: "active" as const,
      },
      threadScope,
    });
    const currentActor = actor();
    const execute = (input: unknown, current = currentActor, currentPolicy = policy) =>
      withDataTransaction(deckDefaultPluginResolveSchemaRequirements, tx => runDeckDefaultPluginResolveOperation(
        "deck.default-plugin.resolve", input, current, tx, currentPolicy,
      ), db);

    await expectAuthFailure(() => execute({}), "DREAM_DATA_SCHEMA_NOT_READY", 503);
    for (const requirement of deckDefaultPluginResolveSchemaRequirements) {
      await setup.query(
        "INSERT INTO drizzle.schema_capabilities (capability,version,contract_sha256) VALUES ($1,$2,$3)",
        [requirement.capability, requirement.version, requirement.contractSha256],
      );
    }

    const before = await setup.query("SELECT (SELECT count(*)::int FROM claude_plugin_installations) AS installations,(SELECT count(*)::int FROM drizzle.schema_capabilities) AS capabilities");
    const resolved = await execute({});
    assert.deepEqual(resolved, {
      installation: {
        plugin_installation_id: "install-tie-z",
        package_name: packageName,
        marketplace: "official",
        resolved_version: version,
        artifact_digest: digestZ,
        compatibility_json: '{"raw":false,"n":9007199254740993}',
      },
    });
    assert.deepEqual(await execute({}, actor(["dream:read"])), resolved);
    assert.deepEqual(await execute({}, currentActor, { ...policy, default_plugin_package_name: "absent-plugin" }), { installation: null });
    assert.deepEqual(await execute({}, currentActor, { ...policy, default_plugin_package_name: "unready-plugin", default_plugin_version: "9.9.9" }), { installation: null });
    assert.deepEqual(await execute({}, currentActor, { ...policy, default_plugin_version: "8.8.8" }), { installation: null });
    assert.deepEqual(await execute({}, currentActor, { ...policy, default_plugin_package_name: "other-plugin", default_plugin_version: "8.8.8" }), { installation: null });

    for (const key of ["actor_id", "user_id", "package_name", "resolved_version", "evidence", "sql", "table", "column"]) {
      assert.equal(deckDefaultPluginResolveOperationContracts["deck.default-plugin.resolve"].input.safeParse({ [key]: "external" }).success, false, `rejects ${key}`);
    }
    assert.equal(deckDefaultPluginResolveOperationContracts["deck.default-plugin.resolve"].input.safeParse({}).success, true);
    await expectAuthFailure(() => execute({ actor_id: "external" }), "INPUT_INVALID", 400);
    await expectAuthFailure(() => execute({}, actor([])), "DREAM_SCOPE_REQUIRED", 403);
    await expectAuthFailure(() => execute({}, actor(["dream:read"], "thread-1")), "DREAM_DELEGATION_ENTITY_DENIED", 403);
    assert.deepEqual((await setup.query("SELECT (SELECT count(*)::int FROM claude_plugin_installations) AS installations,(SELECT count(*)::int FROM drizzle.schema_capabilities) AS capabilities")).rows, before.rows);
    assert.deepEqual(Object.keys(deckDefaultPluginResolveOperationContracts), ["deck.default-plugin.resolve"]);
    evidence = {
      result: "PASS",
      target: "runner-owned-named-disposable-postgresql",
      database_prefix: "ink_auth_data_codex_test_deck_default_plugin_",
      listen_addresses: topology.rows[0].listen,
      server_address: topology.rows[0].address,
      restricted_data_role: true,
      exact_ready_candidate: true,
      absent_unready_mismatched_null: true,
      stable_duplicate_ordering: true,
      raw_compatibility_and_digest: true,
      closed_selectors: true,
      scope_and_entity_denied: true,
      capability_fail_closed: true,
      one_operation: Object.keys(deckDefaultPluginResolveOperationContracts).length,
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

if (!evidence) throw new Error("Deck default-plugin evidence was not produced");
console.log(JSON.stringify({ ...evidence, owned_cluster_removed: true }));
