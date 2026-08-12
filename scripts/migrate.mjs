import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";

import {
  migrationStatus,
  readMigrationPlan,
} from "./lib/migration-journal.mjs";

const cliArguments = process.argv.slice(2);
let throughTag;
let mode = "apply";
for (let index = 0; index < cliArguments.length; index += 1) {
  const argument = cliArguments[index];
  if (argument === "--through") {
    if (throughTag !== undefined || index + 1 >= cliArguments.length) {
      throw new Error("--through requires one exact journal tag");
    }
    throughTag = cliArguments[index + 1];
    index += 1;
  } else if (argument === "--status" || argument === "--check") {
    if (mode !== "apply") throw new Error("Choose only one of --status or --check");
    mode = argument.slice(2);
  } else {
    throw new Error(
      "Usage: node scripts/migrate.mjs [--through <exact-journal-tag>] [--status|--check]",
    );
  }
}
if (throughTag !== undefined && !/^\d{4}_[a-z0-9_]+$/.test(throughTag)) {
  throw new Error("--through requires an exact journal tag");
}

function parseEnvValue(text, name) {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.startsWith("export ") ? line.slice(7).trim() : line;
    const separator = normalized.indexOf("=");
    if (separator <= 0 || normalized.slice(0, separator).trim() !== name) continue;
    const rawValue = normalized.slice(separator + 1).trim();
    if (rawValue.startsWith('"') && rawValue.endsWith('"')) {
      try { return JSON.parse(rawValue); } catch { return rawValue.slice(1, -1); }
    }
    if (rawValue.startsWith("'") && rawValue.endsWith("'")) return rawValue.slice(1, -1);
    return rawValue;
  }
  return undefined;
}

async function resolveMigrationDatabaseUrl() {
  if (process.env.MIGRATION_DATABASE_URL) return process.env.MIGRATION_DATABASE_URL;
  try {
    const localEnv = await readFile(
      fileURLToPath(new URL("../.env.local", import.meta.url)),
      "utf8",
    );
    return parseEnvValue(localEnv, "MIGRATION_DATABASE_URL");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return undefined;
    throw error;
  }
}

const databaseUrl = await resolveMigrationDatabaseUrl();
if (!databaseUrl) {
  throw new Error(
    "MIGRATION_DATABASE_URL is required; schema migration must not reuse the application DATABASE_URL implicitly",
  );
}

const migrationsDirectory = fileURLToPath(new URL("../drizzle/", import.meta.url));
const plan = await readMigrationPlan(migrationsDirectory, throughTag);
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

async function migrationLedgerState({ create, lock = false }) {
  const objects = await client.query(`
    SELECT
      to_regnamespace('drizzle') IS NOT NULL AS schema_exists,
      to_regclass('drizzle.__drizzle_migrations')::text AS ledger_relation
  `);
  const schemaExists = Boolean(objects.rows[0]?.schema_exists);
  const ledgerRelation = objects.rows[0]?.ledger_relation;

  if (!create && !ledgerRelation) return [];
  if (create && !schemaExists) await client.query('CREATE SCHEMA "drizzle"');
  if (create && !ledgerRelation) {
    await client.query(`
      CREATE TABLE "drizzle"."__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
  }

  const columns = await client.query(`
    SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
     WHERE table_schema='drizzle' AND table_name='__drizzle_migrations'
     ORDER BY ordinal_position
  `);
  const signature = columns.rows.map((row) => [
    String(row.column_name), String(row.data_type), String(row.is_nullable),
  ]);
  const expected = [
    ["id", "integer", "NO"],
    ["hash", "text", "NO"],
    ["created_at", "bigint", "YES"],
  ];
  if (JSON.stringify(signature) !== JSON.stringify(expected)) {
    throw new Error("MIGRATION_LEDGER_CONTRACT_MISMATCH: drizzle migration table drift");
  }
  const primaryKey = await client.query(`
    SELECT array_agg(att.attname::text ORDER BY key.position) AS columns
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class rel ON rel.oid=con.conrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid=rel.relnamespace
      CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key(attnum, position)
      JOIN pg_catalog.pg_attribute att ON att.attrelid=rel.oid AND att.attnum=key.attnum
     WHERE ns.nspname='drizzle' AND rel.relname='__drizzle_migrations' AND con.contype='p'
  `);
  if (JSON.stringify(primaryKey.rows[0]?.columns ?? []) !== JSON.stringify(["id"])) {
    throw new Error("MIGRATION_LEDGER_CONTRACT_MISMATCH: migration ledger primary key drift");
  }
  const applied = await client.query(
    `SELECT hash, created_at FROM "drizzle"."__drizzle_migrations"${lock ? " FOR UPDATE" : ""}`,
  );
  return applied.rows;
}

try {
  if (mode === "apply") {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      ["ink-admin-memory:drizzle-migrations"],
    );
    const appliedRows = await migrationLedgerState({ create: true, lock: true });
    const status = migrationStatus(plan, appliedRows);
    for (const migration of status.pending) {
      for (const statement of migration.statements) await client.query(statement);
      await client.query(
        `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`,
        [migration.hash, migration.createdAt],
      );
      console.log(`Applied migration ${migration.tag}`);
    }
    await client.query("COMMIT");
    console.log("Generated database migrations applied successfully");
  } else {
    await client.query("BEGIN READ ONLY");
    const appliedRows = await migrationLedgerState({ create: false });
    const status = migrationStatus(plan, appliedRows);
    const receipt = {
      status: status.pending.length === 0 ? "current" : "pending",
      appliedCount: status.appliedCount,
      targetCount: status.targetCount,
      availableCount: status.availableCount,
      pendingTags: status.pending.map((migration) => migration.tag),
      latestApplied: status.latestApplied,
      latestTarget: status.latestTarget,
      latestAvailable: status.latestAvailable,
    };
    await client.query("ROLLBACK");
    console.log(JSON.stringify(receipt));
    if (mode === "check" && receipt.status !== "current") process.exitCode = 1;
  }
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
