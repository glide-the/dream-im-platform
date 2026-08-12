#!/usr/bin/env node

// Audited backfill for the gateway-default-token-limits-v1 platform policy.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import pg from "pg";

import { gatewayDefaultLimitsPolicy } from "../../config/gateway-default-limits.mjs";
import { recordGatewayDefaultLimitsReceipt } from "./registry.mjs";

const adminRoot = resolve(fileURLToPath(new URL("../../", import.meta.url)));
config({ path: resolve(adminRoot, ".env.local"), quiet: true });

const apply = process.argv.includes("--apply");
const allowedArguments = new Set(["--apply"]);
for (const argument of process.argv.slice(2)) {
  if (!allowedArguments.has(argument)) {
    throw new Error("Usage: node drizzle/data/gateway-default-token-limits.mjs [--apply]");
  }
}

function targetDatabaseUrl() {
  const useTestDatabase = process.env.INK_USE_TEST_DATABASE_URL === "1";
  const variableName = useTestDatabase ? "TEST_DATABASE_URL" : "DATABASE_URL";
  const raw = process.env[variableName];
  if (!raw) throw new Error(`${variableName} is required`);
  const parsed = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Gateway limit backfill requires PostgreSQL");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const testMarkers = new Set(databaseName.toLowerCase().split(/[^a-z0-9]+/));
  const safeTestName = ["codex", "test", "tests", "tmp", "temp", "ci", "sandbox"]
    .some((marker) => testMarkers.has(marker));
  if (!localHosts.has(parsed.hostname)
    || (useTestDatabase ? !safeTestName : databaseName !== "ink-memory")) {
    throw new Error("Gateway limit backfill rejected the database safety identity");
  }
  return raw;
}

function assertPolicy() {
  if (gatewayDefaultLimitsPolicy.revision !== "gateway-default-token-limits-v1"
    || !Number.isSafeInteger(gatewayDefaultLimitsPolicy.dailyTokenLimit)
    || !Number.isSafeInteger(gatewayDefaultLimitsPolicy.monthlyTokenLimit)
    || gatewayDefaultLimitsPolicy.dailyTokenLimit !== 1_000_000_000
    || gatewayDefaultLimitsPolicy.monthlyTokenLimit !== 10_000_000_000) {
    throw new Error("Gateway default-limit policy is invalid");
  }
}

function postgresIntegerDefault(value) {
  const match = String(value ?? "").match(
    /^'?([0-9]+)'?(?:::[a-z_ ]+)?$/,
  );
  return match ? Number(match[1]) : Number.NaN;
}

const databaseUrl = targetDatabaseUrl();
assertPolicy();
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
let receipt;
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [gatewayDefaultLimitsPolicy.revision],
  );
  const definition = await client.query(
    `SELECT runner_contract
       FROM drizzle.data_migration_definitions
      WHERE migration_key = $1
      FOR SHARE`,
    [gatewayDefaultLimitsPolicy.revision],
  );
  if (definition.rows[0]?.runner_contract
    !== "ink-admin-gateway-default-token-limits-v1") {
    throw new Error("Apply Drizzle migration 0035 before the Gateway limit backfill");
  }
  const defaults = await client.query(
    `SELECT column_name, column_default
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'platform_users'
        AND column_name = ANY($1::text[])`,
    [["daily_token_limit", "monthly_token_limit"]],
  );
  const byColumn = new Map(defaults.rows.map((row) => [
    row.column_name,
    postgresIntegerDefault(row.column_default),
  ]));
  if (byColumn.get("daily_token_limit")
      !== gatewayDefaultLimitsPolicy.dailyTokenLimit
    || byColumn.get("monthly_token_limit")
      !== gatewayDefaultLimitsPolicy.monthlyTokenLimit) {
    throw new Error("Gateway limit schema defaults do not match the policy");
  }
  const inventory = await client.query(
    `SELECT
       (SELECT count(*)::int FROM platform_users) AS total_users,
       (SELECT count(*)::int FROM users) AS canonical_users,
       (SELECT count(*)::int
          FROM users AS canonical
          LEFT JOIN platform_users AS platform
            ON platform.source = 'ink-dream'
           AND platform.external_user_id = canonical.id::text
         WHERE platform.id IS NULL) AS missing_canonical_projections,
       (SELECT count(*)::int
          FROM platform_users
         WHERE daily_token_limit IS DISTINCT FROM $1::bigint
            OR monthly_token_limit IS DISTINCT FROM $2::bigint) AS mismatches`,
    [
      gatewayDefaultLimitsPolicy.dailyTokenLimit,
      gatewayDefaultLimitsPolicy.monthlyTokenLimit,
    ],
  );
  const before = inventory.rows[0];
  if (Number(before?.missing_canonical_projections) !== 0) {
    throw new Error("Canonical users are missing platform projections");
  }
  let changedUsers = 0;
  if (apply) {
    const updated = await client.query(
      `WITH changed AS (
         UPDATE platform_users
            SET daily_token_limit = $1,
                monthly_token_limit = $2,
                updated_at = NOW()
          WHERE daily_token_limit IS DISTINCT FROM $1::bigint
             OR monthly_token_limit IS DISTINCT FROM $2::bigint
          RETURNING id
       ) SELECT count(*)::int AS count FROM changed`,
      [
        gatewayDefaultLimitsPolicy.dailyTokenLimit,
        gatewayDefaultLimitsPolicy.monthlyTokenLimit,
      ],
    );
    changedUsers = Number(updated.rows[0]?.count ?? 0);
  } else {
    changedUsers = Number(before?.mismatches ?? 0);
  }
  const verification = await client.query(
    `SELECT count(*)::int AS count
       FROM platform_users
      WHERE daily_token_limit IS DISTINCT FROM $1::bigint
         OR monthly_token_limit IS DISTINCT FROM $2::bigint`,
    [
      gatewayDefaultLimitsPolicy.dailyTokenLimit,
      gatewayDefaultLimitsPolicy.monthlyTokenLimit,
    ],
  );
  receipt = {
    contract: "ink-admin-gateway-default-token-limits-v1",
    revision: gatewayDefaultLimitsPolicy.revision,
    mode: apply ? "applied" : "dry-run",
    dailyTokenLimit: gatewayDefaultLimitsPolicy.dailyTokenLimit,
    monthlyTokenLimit: gatewayDefaultLimitsPolicy.monthlyTokenLimit,
    totalUsers: Number(before?.total_users ?? 0),
    canonicalUsers: Number(before?.canonical_users ?? 0),
    changedUsers,
    remainingMismatches: apply
      ? Number(verification.rows[0]?.count ?? 0)
      : Number(before?.mismatches ?? 0),
    missingCanonicalProjections: Number(before?.missing_canonical_projections ?? 0),
    effect: "429-only",
    redacted: true,
  };
  if (apply) await client.query("COMMIT");
  else await client.query("ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end();
}

const registry = apply
  ? await recordGatewayDefaultLimitsReceipt(databaseUrl, receipt)
  : null;
console.log(JSON.stringify({ ...receipt, registry }));
