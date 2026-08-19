#!/usr/bin/env node
// [Input] Self-owned disposable PostgreSQL 16 plus the full Admin Drizzle journal and frozen Dream adoption fixtures.
// [Output] Fresh/adopted/partial/concurrent/idempotent migration evidence through Remote Marketplace migration 0037.
// [Pos] Destructive-safe shared Dream schema cutover harness; it creates and removes only its randomized Docker resources.
// [Sync] 2026-08-19: include 0037 Remote Marketplace receipt/capability counts in every success mode.

import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import pg from "pg";

import { captureDreamSchemaContract } from "./lib/dream-schema-contract.mjs";
import {
  LEGACY_MIGRATION_KEY_V1,
  legacySourceFingerprint,
  recordLegacyReceipt,
} from "../drizzle/data/registry.mjs";

const execute = promisify(execFile);
const adminRoot = new URL("../", import.meta.url).pathname;
const suffix = randomBytes(5).toString("hex");
const containerName = `ink-schema-cutover-e2e-${suffix}`;
const controlDatabase = `ink_schema_control_${suffix}`;
const password = `pg_${randomBytes(24).toString("base64url")}`;
const tableNames = JSON.parse(await readFile(
  new URL("../drizzle/contracts/dream-table-names.json", import.meta.url),
  "utf8",
));
const expectedContract = JSON.parse(await readFile(
  new URL("../drizzle/contracts/current-catalog.json", import.meta.url),
  "utf8",
));
const cutoverSql = await readFile(
  new URL("../drizzle/0032_dream_schema_authority_cutover.sql", import.meta.url),
  "utf8",
);
const legacyBootstrapStatements = [...cutoverSql.matchAll(
  /EXECUTE \$dream_ddl_(\d{3})\$([\s\S]*?)\$dream_ddl_\1\$;/g,
)].map((match, index) => {
  if (Number(match[1]) !== index) {
    throw new Error("0032 Dream bootstrap statements are not a contiguous ordered sequence");
  }
  return match[2];
});
if (legacyBootstrapStatements.length !== 167) {
  throw new Error("0032 Dream bootstrap statement count changed; review the legacy fixture");
}
let started = false;
let port;

async function capture(command, args, options = {}) {
  const result = await execute(command, args, {
    cwd: options.cwd ?? adminRoot,
    env: options.env ?? process.env,
    maxBuffer: 64 * 1024 * 1024,
  });
  return result.stdout.trim();
}

function databaseName(label) {
  const name = `ink_${label}_codex_test_${suffix}`;
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error("Unsafe disposable database name");
  return name;
}

function databaseUrl(name) {
  return `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/${name}`;
}

async function withClient(name, callback) {
  const client = new pg.Client({ connectionString: databaseUrl(name) });
  await client.connect();
  try {
    return await callback(client);
  } finally {
    await client.end();
  }
}

async function waitForPostgres() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await withClient(controlDatabase, (client) => client.query("SELECT 1"));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Disposable PostgreSQL did not become ready");
}

async function createDatabase(name, template = null) {
  await withClient(controlDatabase, (client) => client.query(
    template
      ? `CREATE DATABASE "${name}" TEMPLATE "${template}"`
      : `CREATE DATABASE "${name}"`,
  ));
}

function migrationEnv(name) {
  return {
    ...process.env,
    MIGRATION_DATABASE_URL: databaseUrl(name),
  };
}

async function migrate(name, through = null) {
  const args = ["scripts/migrate.mjs"];
  if (through) args.push("--through", through);
  return capture("node", args, { env: migrationEnv(name) });
}

async function checkMigrations(name) {
  return capture("node", ["scripts/migrate.mjs", "--check"], {
    env: migrationEnv(name),
  });
}

async function expectMigrationFailure(name, expectedCode, expectedReceiptCount) {
  const error = await migrate(name).then(() => null, (caught) => caught);
  const output = `${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
  if (!error || !output.includes(expectedCode)) {
    throw new Error(`Expected safe migration failure ${expectedCode}`);
  }
  await withClient(name, async (client) => {
    const result = await client.query(
      `SELECT
         (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS receipts,
         to_regclass('drizzle.schema_capabilities')::text AS capability_table`,
    );
    if (result.rows[0].receipts !== expectedReceiptCount
      || result.rows[0].capability_table !== null) {
      throw new Error("Failed cutover left a receipt or capability table");
    }
  });
}

async function applyLegacy06(name) {
  await withClient(name, async (client) => {
    await client.query("BEGIN");
    try {
      for (const statement of legacyBootstrapStatements) {
        await client.query(statement);
      }
      await client.query(
        `CREATE TABLE public.dream_alembic_version (
           version_num varchar(32) PRIMARY KEY
         )`,
      );
      await client.query(
        "INSERT INTO public.dream_alembic_version (version_num) VALUES ('20260809_06')",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function stageLegacyContinuingFixture(name) {
  await withClient(name, async (client) => {
    await client.query("BEGIN");
    try {
      // The disposable fixture isolates the state-label correction itself.
      // FK targets are intentionally omitted and ALL triggers are disabled
      // only around fixture setup/cleanup; production 0033 never disables
      // constraint triggers.
      await client.query("ALTER TABLE workflow_runs DISABLE TRIGGER ALL");
      await client.query("ALTER TABLE workflow_run_transitions DISABLE TRIGGER ALL");
      await client.query(`
        INSERT INTO workflow_runs (
          id, workspace_id, deck_plugin_id, deck_plugin_version,
          workflow_definition_ref, deck_runtime_snapshot_id, status,
          deck_plugin_manifest_hash, deck_plugin_binding_id, binding_revision,
          runtime_plugin_lock_id, workflow_preflight_id, idempotency_key,
          input_hash, semantic_fingerprint, status_version, created_by
        ) VALUES (
          'run_legacy_continuing_fixture', 'workspace_fixture', 'plugin_fixture',
          '1.0.0', 'workflow-fixture', 'snapshot_fixture', 'continuing',
          'sha256:fixture', 'binding_fixture', 1, 'lock_fixture',
          'preflight_fixture', 'fixture-key', 'sha256:input',
          'sha256:semantic', 8, 'fixture-actor'
        )
      `);
      await client.query(`
        INSERT INTO workflow_run_transitions (
          id, workflow_run_id, transition_seq, from_status, to_status, actor_id
        ) VALUES
          ('transition_fixture_1', 'run_legacy_continuing_fixture', 7,
           'confirmed', 'continuing', 'fixture-actor'),
          ('transition_fixture_2', 'run_legacy_continuing_fixture', 8,
           'continuing', 'completed', 'fixture-actor')
      `);
      await client.query("ALTER TABLE workflow_run_transitions ENABLE TRIGGER ALL");
      await client.query("ALTER TABLE workflow_runs ENABLE TRIGGER ALL");
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function verifyAndRemoveLegacyContinuingFixture(name) {
  await withClient(name, async (client) => {
    const corrected = await client.query(`
      SELECT
        (SELECT status FROM workflow_runs
          WHERE id='run_legacy_continuing_fixture') AS run_status,
        array_agg(from_status || '>' || to_status ORDER BY transition_seq) AS transitions
      FROM workflow_run_transitions
      WHERE workflow_run_id='run_legacy_continuing_fixture'
    `);
    if (corrected.rows[0]?.run_status !== "confirmed"
      || JSON.stringify(corrected.rows[0]?.transitions) !== JSON.stringify([
        "confirmed>confirmed",
        "confirmed>completed",
      ])) {
      throw new Error("0033 did not normalize the legacy continuing fixture");
    }
    await client.query("BEGIN");
    try {
      await client.query("ALTER TABLE workflow_run_transitions DISABLE TRIGGER USER");
      await client.query(
        "DELETE FROM workflow_run_transitions WHERE workflow_run_id='run_legacy_continuing_fixture'",
      );
      await client.query("ALTER TABLE workflow_run_transitions ENABLE TRIGGER USER");
      await client.query(
        "DELETE FROM workflow_runs WHERE id='run_legacy_continuing_fixture'",
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

async function verifySuccess(name, { expectedLegacyHead = null, sampleUser = false } = {}) {
  await withClient(name, async (client) => {
    const contract = await captureDreamSchemaContract(client, tableNames);
    if (contract.catalogSha256 !== expectedContract.catalogSha256) {
      throw new Error("Adopted Dream catalog hash does not match the checked-in contract");
    }
    const result = await client.query(
      `SELECT
         (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS receipts,
         (SELECT count(DISTINCT hash)::int FROM drizzle.__drizzle_migrations) AS distinct_receipts,
         (SELECT count(*)::int FROM drizzle.schema_capabilities) AS capabilities,
         (SELECT count(DISTINCT contract_sha256)::int
            FROM drizzle.schema_capabilities) AS capability_hashes,
         (SELECT version FROM drizzle.schema_capabilities
           WHERE capability='dream.workflow.no-continuing.v1') AS lifecycle_capability,
         (SELECT version FROM drizzle.schema_capabilities
           WHERE capability='dream.runtime.local-placement.v1') AS placement_capability,
         (SELECT count(*)::int FROM runtime_load_receipts
           WHERE deployment_tier <> 'local') AS nonlocal_receipts,
         (SELECT count(*)::int FROM agent_sessions
           WHERE deployment_tier <> 'local') AS nonlocal_sessions,
         (SELECT count(*)::int FROM workflow_runs
           WHERE status='continuing') AS continuing_runs,
         (SELECT count(*)::int FROM workflow_run_transitions
           WHERE from_status='continuing' OR to_status='continuing') AS continuing_transitions,
         position(
           'continuing' IN pg_get_functiondef(
             'public.dream_guard_workflow_runs_joint_session_binding_guard()'::regprocedure
           )
         ) AS continuing_guard_position,
         to_regclass('public.dream_alembic_version')::text AS legacy_table,
         (SELECT count(*)::int FROM users WHERE email='cutover-proof@example.invalid') AS proof_users`,
    );
    const row = result.rows[0];
    const legacyHead = row.legacy_table === null
      ? null
      : (await client.query(
          "SELECT version_num FROM public.dream_alembic_version",
        )).rows[0]?.version_num ?? null;
    if (row.receipts !== 38 || row.distinct_receipts !== 38
      || row.capabilities !== 7 || row.capability_hashes !== 4
      || row.lifecycle_capability !== 1 || row.placement_capability !== 1
      || row.nonlocal_receipts !== 0 || row.nonlocal_sessions !== 0
      || row.continuing_runs !== 0 || row.continuing_transitions !== 0
      || row.continuing_guard_position !== 0
      || legacyHead !== expectedLegacyHead
      || row.proof_users !== (sampleUser ? 1 : 0)) {
      throw new Error("Successful cutover evidence is incomplete");
    }
  });
}

async function verifyLegacyV1ReceiptReuse(name) {
  const tables = tableNames.map((table, index) => ({
    source: index < 43 ? "main" : "notion",
    table,
    sourceCount: index === 0 ? 4921 : 0,
    pkSha256: "a".repeat(64),
    rowSha256: "b".repeat(64),
  }));
  const receipt = {
    contract: "ink-dream-legacy-postgres-import-v1",
    status: "adopted_exact",
    mode: "verify-existing",
    runId: randomUUID(),
    manifestSha256: "c".repeat(64),
    validation: {
      tables: 48,
      sourceRows: 4921,
      sourceForeignKeyChecks: 1,
    },
    security: {
      containsBusinessValues: false,
      containsSourcePaths: false,
      containsDsn: false,
      implicitOverwrite: false,
      destructiveTargetCleanup: false,
    },
    source: {
      main: { snapshotSha256: "d".repeat(64) },
      notion: { snapshotSha256: "e".repeat(64) },
    },
    target: {
      insertedRows: 0,
      verifiedSourcePrimaryKeys: 4921,
      exactMatchedRows: 4921,
      postCutoverChangedRows: 0,
      targetExtraRows: 0,
      foreignKeyChecks: 1,
      transaction: "read_only",
    },
    tables,
  };
  const fingerprint = legacySourceFingerprint(receipt);
  const legacyRunId = randomUUID();
  await withClient(name, (client) => client.query(
    `INSERT INTO drizzle.data_migration_runs (
       run_id, migration_key, status, runner_mode,
       source_fingerprint_sha256, source_table_count, source_row_count, summary
     ) VALUES ($1::uuid,$2,'committed','legacy-v1',$3,48,4921,'{"redacted":true}'::jsonb)`,
    [legacyRunId, LEGACY_MIGRATION_KEY_V1, fingerprint],
  ));
  const reused = await recordLegacyReceipt(databaseUrl(name), receipt);
  if (!reused.reused || reused.recorded
    || reused.runId !== legacyRunId || reused.migrationKey !== LEGACY_MIGRATION_KEY_V1) {
    throw new Error("A matching immutable V1 data receipt was not reused");
  }
  await withClient(name, async (client) => {
    const result = await client.query(
      "SELECT count(*)::int AS runs FROM drizzle.data_migration_runs",
    );
    if (result.rows[0].runs !== 1) {
      throw new Error("V1 receipt reuse unexpectedly created a V2 run");
    }
  });
}

try {
  await capture("docker", [
    "run", "--detach", "--rm", "--name", containerName,
    "--env", "POSTGRES_USER=postgres",
    "--env", `POSTGRES_PASSWORD=${password}`,
    "--env", `POSTGRES_DB=${controlDatabase}`,
    "--publish", "127.0.0.1::5432", "postgres:16-alpine",
  ]);
  started = true;
  const portLine = await capture("docker", ["port", containerName, "5432/tcp"]);
  const match = portLine.match(/127\.0\.0\.1:(\d+)/);
  if (!match) throw new Error("Disposable PostgreSQL port was not published");
  port = match[1];
  await waitForPostgres();

  const legacy06 = databaseName("legacy06");
  await createDatabase(legacy06);
  await migrate(legacy06, "0026_harsh_victor_mancha");
  await withClient(legacy06, (client) => client.query(
    `INSERT INTO users (email, password_hash, display_name)
     VALUES ('cutover-proof@example.invalid', 'not-a-real-secret', 'Cutover proof')`,
  ));
  await applyLegacy06(legacy06);
  await migrate(legacy06, "0031_dream_artifact_contract_guards");

  const legacy06Missing = databaseName("legacy06_missing");
  const legacy07 = databaseName("legacy07");
  const unknown = databaseName("unknown");
  await createDatabase(legacy06Missing, legacy06);
  await createDatabase(legacy07, legacy06);
  await createDatabase(unknown, legacy06);
  await withClient(legacy06Missing, (client) => client.query(
    "DROP INDEX idx_workflow_runs_source_voice_thread",
  ));
  await withClient(legacy07, (client) => client.query(
    "UPDATE dream_alembic_version SET version_num='20260811_07'",
  ));
  await withClient(unknown, (client) => client.query(
    "UPDATE dream_alembic_version SET version_num='20991231_unknown'",
  ));

  const partial = databaseName("partial");
  await createDatabase(partial);
  await migrate(partial, "0026_harsh_victor_mancha");
  await withClient(partial, (client) => client.query(
    "CREATE TABLE chat_thread (id text PRIMARY KEY)",
  ));

  const fresh = databaseName("fresh");
  await createDatabase(fresh);
  await migrate(fresh);
  await verifySuccess(fresh);
  await migrate(fresh);
  await verifySuccess(fresh);
  await checkMigrations(fresh);

  const legacyContinuing = databaseName("legacy_continuing");
  await createDatabase(legacyContinuing);
  await migrate(legacyContinuing, "0032_dream_schema_authority_cutover");
  await stageLegacyContinuingFixture(legacyContinuing);
  await migrate(legacyContinuing);
  await verifyAndRemoveLegacyContinuingFixture(legacyContinuing);
  await verifySuccess(legacyContinuing);

  await migrate(legacy06);
  await verifySuccess(legacy06, { expectedLegacyHead: "20260809_06", sampleUser: true });
  await migrate(legacy06Missing);
  await verifySuccess(legacy06Missing, {
    expectedLegacyHead: "20260809_06",
    sampleUser: true,
  });
  await migrate(legacy07);
  await verifySuccess(legacy07, { expectedLegacyHead: "20260811_07", sampleUser: true });

  await expectMigrationFailure(unknown, "DREAM_SCHEMA_UNKNOWN_ALEMBIC_HEAD", 32);
  await expectMigrationFailure(
    partial,
    "DREAM_SCHEMA_PARTIAL_OR_UNKNOWN_BASELINE",
    27,
  );

  const concurrent = databaseName("concurrent");
  await createDatabase(concurrent);
  await Promise.all([migrate(concurrent), migrate(concurrent)]);
  await verifySuccess(concurrent);

  const legacyReceipt = databaseName("legacy_receipt");
  await createDatabase(legacyReceipt);
  await migrate(legacyReceipt);
  await verifyLegacyV1ReceiptReuse(legacyReceipt);

  console.log(JSON.stringify({
    status: "passed",
    successModes: ["fresh", "legacy_continuing", "alembic_06_existing_index", "alembic_06_missing_index", "alembic_07"],
    failureModes: ["partial", "unknown_head"],
    idempotent: true,
    migrationCheck: true,
    concurrentMigrators: 2,
    receipts: 38,
    capabilities: 7,
    legacyV1ReceiptReused: true,
    catalogSha256: expectedContract.catalogSha256,
    disposablePostgresRemoved: true,
  }));
} finally {
  if (started) {
    await capture("docker", ["stop", "--time", "2", containerName])
      .catch(() => undefined);
  }
}
