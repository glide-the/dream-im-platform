#!/usr/bin/env node

// [Input] Disposable PostgreSQL/Dream test roots and checked-in migration/data runner contracts.
// [Output] Isolated full-data-migration E2E with synthetic control-plane dependencies and cleanup.
// [Pos] Test harness only; synthetic legacy Provider rows intentionally exercise forward-migration compatibility.
// [Sync] 2026-09-04: document active/unverified Provider compatibility after migration 0044.

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";

const execute = promisify(execFile);
const adminRoot = new URL("../", import.meta.url).pathname;
const dreamRoot = new URL("../../ink-dream-memory/", import.meta.url).pathname;
const suffix = randomBytes(6).toString("hex");
const databaseName = `ink_memory_codex_data_${suffix}`;
const containerName = `ink-data-migration-e2e-${suffix}`;
const password = `pg_${randomBytes(24).toString("base64url")}`;
let started = false;

async function capture(command, args, options = {}) {
  const result = await execute(command, args, {
    cwd: options.cwd ?? adminRoot,
    env: options.env ?? process.env,
    maxBuffer: 32 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function waitForPostgres(databaseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const client = new pg.Client({ connectionString: databaseUrl });
    try {
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      return;
    } catch {
      await client.end().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Disposable PostgreSQL did not become ready");
}

async function provisionSyntheticModel(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN");
    // Intentionally models a migration-compatible legacy effective Provider:
    // 0044 defaults it to auth_revision=1/unverified without disabling it.
    await client.query(
      `INSERT INTO ai_providers (
         id, code, name, protocol, base_url,
         api_key_ciphertext, api_key_iv, api_key_tag, status
       ) VALUES (
         'provider_data_e2e', 'provider-data-e2e', 'Data migration E2E',
         'anthropic', 'https://api.anthropic.com',
         'synthetic-ciphertext', 'synthetic-iv', 'synthetic-tag', 'active'
       )`,
    );
    await client.query(
      `INSERT INTO ai_models (
         id, provider_id, code, upstream_model, display_name,
         capabilities, enabled
       ) VALUES (
         'model_data_e2e', 'provider_data_e2e', 'claude-data-e2e',
         'claude-data-e2e-upstream', 'Claude Data E2E',
         '{"tools":true}'::jsonb, TRUE
       )`,
    );
    await client.query(
      `INSERT INTO ai_pricing_rules (
         id, model_id, user_tier, input_price_microusd_per_million,
         output_price_microusd_per_million, status, effective_from
       ) VALUES (
         'pricing_data_e2e', 'model_data_e2e', 'default', 1000000,
         2000000, 'active', NOW() - interval '1 minute'
       )`,
    );
    await client.query(
      `INSERT INTO subscription_plans (id, code, name, status)
       VALUES ('plan_data_e2e', 'data-migration-e2e-proof',
               'Data migration E2E proof', 'active')`,
    );
    await client.query(
      `INSERT INTO subscription_plan_versions (
         id, plan_id, version_number, status, billing_period,
         allowance_tokens, overage_policy
       ) VALUES (
         'planv_data_e2e', 'plan_data_e2e', 1, 'draft', 'monthly', 1, 'deny'
       )`,
    );
    await client.query(
      `INSERT INTO subscription_plan_entitlements (
         id, plan_version_id, model_id, gateway_scopes, enabled
       ) VALUES (
         'ent_data_e2e', 'planv_data_e2e', 'model_data_e2e',
         ARRAY['messages:create','models:list']::text[], TRUE
       )`,
    );
    await client.query(
      `UPDATE subscription_plan_versions
          SET status='published', published_at=NOW(), updated_at=NOW()
        WHERE id='planv_data_e2e'`,
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

try {
  await capture("docker", [
    "run", "--detach", "--rm", "--name", containerName,
    "--env", "POSTGRES_USER=postgres",
    "--env", `POSTGRES_PASSWORD=${password}`,
    "--env", `POSTGRES_DB=${databaseName}`,
    "--publish", "127.0.0.1::5432", "postgres:16-alpine",
  ]);
  started = true;
  const portLine = await capture("docker", ["port", containerName, "5432/tcp"]);
  const match = portLine.match(/127\.0\.0\.1:(\d+)/);
  if (!match) throw new Error("Disposable PostgreSQL port was not published");
  const databaseUrl = `postgresql://postgres:${encodeURIComponent(password)}@127.0.0.1:${match[1]}/${databaseName}`;
  await waitForPostgres(databaseUrl);

  const adminEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    MIGRATION_DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    INK_USE_TEST_DATABASE_URL: "1",
  };
  await capture("node", ["scripts/migrate.mjs"], {
    cwd: adminRoot,
    env: adminEnv,
  });

  const mainSqlite = `${dreamRoot}backend/data/ink-and-memory.db`;
  const notionSqlite = `${dreamRoot}backend/data/notion-connectors.db`;
  const legacyArgs = [
    "drizzle/data/legacy-43-plus-5.mjs",
    "--main-sqlite", mainSqlite,
    "--notion-sqlite", notionSqlite,
    "--mode", "execute",
    "--expected-target-database", databaseName,
    "--approve-baseline-inserts",
    "--record",
    "--full-receipt",
  ];
  const firstLegacyOutput = JSON.parse(await capture("node", legacyArgs, {
    cwd: adminRoot,
    env: { ...adminEnv, DATABASE_URL: "" },
  }));
  const firstLegacy = firstLegacyOutput.receipt;
  const sourceRows = firstLegacy.validation.sourceRows;
  const sourceUsers = firstLegacy.tables.find((table) => table.table === "users")?.sourceCount;
  if (firstLegacy.status !== "committed"
    || firstLegacy.target.insertedRows !== sourceRows
    || !Number.isSafeInteger(sourceUsers)
    || firstLegacyOutput.registry?.recorded !== true
    || firstLegacyOutput.registry?.migrationKey !== "dream-legacy-43-plus-5-v2-drizzle") {
    throw new Error("Fresh 43+5 import did not commit and record the complete source");
  }

  const conflict = await execute("node", legacyArgs.filter((value) => value !== "--record"), {
    cwd: adminRoot,
    env: { ...adminEnv, DATABASE_URL: "" },
    maxBuffer: 32 * 1024 * 1024,
  }).then(() => null, (error) => JSON.parse(error.stderr.trim()));
  if (conflict?.errorCode !== "TARGET_CONFLICTS_DETECTED") {
    throw new Error("Repeated execute did not block the non-empty target");
  }

  const adoptionArgs = [
    "drizzle/data/legacy-43-plus-5.mjs",
    "--main-sqlite", mainSqlite,
    "--notion-sqlite", notionSqlite,
    "--mode", "verify-existing",
    "--accept-post-cutover-changes",
    "--expected-target-database", databaseName,
    "--expected-target-host", "127.0.0.1",
    "--expected-target-port", match[1],
    "--expected-target-owner", "postgres",
    "--target-approval", `VERIFY-43+5-IN:${databaseName}`,
    "--record",
  ];
  adoptionArgs.push("--full-receipt");
  const repeatedLegacy = JSON.parse(await capture("node", adoptionArgs, {
    cwd: adminRoot,
    env: adminEnv,
  }));
  if (repeatedLegacy.receipt.status !== "adopted_exact"
    || repeatedLegacy.registry?.reused !== true) {
    throw new Error("Repeated source fingerprint did not reuse the committed receipt");
  }

  await provisionSyntheticModel(databaseUrl);
  const planArgs = ["drizzle/data/default-dream-plans.mjs", "--apply"];
  const firstPlans = JSON.parse(await capture("node", planArgs, {
    cwd: adminRoot,
    env: adminEnv,
  }));
  const repeatedPlans = JSON.parse(await capture("node", planArgs, {
    cwd: adminRoot,
    env: adminEnv,
  }));
  if (firstPlans.registry?.recorded !== true || repeatedPlans.registry?.reused !== true) {
    throw new Error("Default Dream plan seed was not recorded idempotently");
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let evidence;
  try {
    const result = await client.query(
      `SELECT
         to_regclass('public.dream_alembic_version')::text AS alembic_table,
         (SELECT count(*)::int FROM drizzle.__drizzle_migrations) AS drizzle_migrations,
         (SELECT count(*)::int FROM drizzle.data_migration_definitions) AS definitions,
         (SELECT count(*)::int FROM drizzle.schema_capabilities) AS capabilities,
         (SELECT migration_key FROM drizzle.data_migration_runs
           WHERE migration_key LIKE 'dream-legacy-43-plus-5-%'
           LIMIT 1) AS legacy_migration_key,
         (SELECT count(*)::int FROM drizzle.data_migration_runs) AS runs,
         (SELECT count(*)::int FROM drizzle.data_migration_table_results) AS table_results,
         (SELECT sum(source_count)::int FROM drizzle.data_migration_table_results) AS source_rows,
         (SELECT count(*)::int FROM users) AS users,
         (SELECT count(*)::int FROM subscriptions
           WHERE status='active') AS active_subscriptions,
         (SELECT count(*)::int FROM subscription_plans
           WHERE code IN ('free','dream','is-dreaming')) AS default_plans`,
    );
    evidence = result.rows[0];
    await client.query("BEGIN");
    let appendOnlySqlstate = null;
    try {
      await client.query(
        "UPDATE drizzle.data_migration_runs SET runner_mode='forbidden'",
      );
    } catch (error) {
      appendOnlySqlstate = error.code;
    }
    await client.query("ROLLBACK");
    evidence.append_only_sqlstate = appendOnlySqlstate;
  } finally {
    await client.end();
  }
  if (evidence.alembic_table !== null
    || evidence.drizzle_migrations !== 33
    || evidence.definitions !== 3
    || evidence.capabilities !== 3
    || evidence.legacy_migration_key !== "dream-legacy-43-plus-5-v2-drizzle"
    || evidence.runs !== 2
    || evidence.table_results !== 48
    || evidence.source_rows !== sourceRows
    || evidence.users !== sourceUsers
    || evidence.active_subscriptions !== sourceUsers
    || evidence.default_plans !== 3
    || evidence.append_only_sqlstate !== "55000") {
    throw new Error(`Disposable data migration evidence mismatch: ${JSON.stringify(evidence)}`);
  }
  console.log(JSON.stringify({
    status: "passed",
    imported: { tables: 48, rows: sourceRows },
    subscriptions: { plans: 3, activeUsers: evidence.active_subscriptions },
    registry: { runs: evidence.runs, tableResults: evidence.table_results },
    idempotent: true,
    conflictBlocked: true,
    appendOnlySqlstate: evidence.append_only_sqlstate,
    disposablePostgresRemoved: true,
  }));
} finally {
  if (started) {
    await capture("docker", ["stop", "--time", "2", containerName])
      .catch(() => undefined);
  }
}
