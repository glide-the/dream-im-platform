// [Input] Immutable Drizzle history plus an explicit or embedded migration target.
// [Output] Atomic migration application or machine-readable status/check receipt.
// [Pos] Sole generated-schema migration entry for @ink-memory/db releases.
// [Sync] 2026-08-21: replace the app-local runner with a Paperclip-style package migration command.
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrationStatus, readMigrationPlan } from "./migration-journal.js";
import { resolveMigrationConnection } from "./migration-runtime.js";

const argumentsList = process.argv.slice(2);
let throughTag: string | undefined;
let mode: "apply" | "status" | "check" = "apply";
for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--through") {
    if (throughTag !== undefined || !argumentsList[index + 1]) throw new Error("--through requires one exact journal tag");
    throughTag = argumentsList[++index];
  } else if (argument === "--status" || argument === "--check") {
    if (mode !== "apply") throw new Error("Choose only one of --status or --check");
    mode = argument.slice(2) as "status" | "check";
  } else {
    throw new Error("Usage: pnpm --filter @ink-memory/db migrate [--through <exact-journal-tag>] [--status|--check]");
  }
}
if (throughTag !== undefined && !/^\d{4}_[a-z0-9_]+$/.test(throughTag)) throw new Error("--through requires an exact journal tag");

const migrationsDirectory = process.env.INK_MIGRATIONS_DIR?.trim()
  ? path.resolve(process.env.INK_MIGRATIONS_DIR)
  : fileURLToPath(new URL("../../../drizzle/", import.meta.url));
const plan = await readMigrationPlan(migrationsDirectory, throughTag);
const connection = await resolveMigrationConnection();
const pool = new pg.Pool({ connectionString: connection.connectionString, max: 1 });
const client = await pool.connect();

async function migrationLedgerState(create: boolean, lock = false) {
  const objects = await client.query(`SELECT to_regnamespace('drizzle') IS NOT NULL AS schema_exists, to_regclass('drizzle.__drizzle_migrations')::text AS ledger_relation`);
  const schemaExists = Boolean(objects.rows[0]?.schema_exists);
  const ledgerRelation = objects.rows[0]?.ledger_relation;
  if (!create && !ledgerRelation) return [];
  if (create && !schemaExists) await client.query('CREATE SCHEMA "drizzle"');
  if (create && !ledgerRelation) await client.query(`CREATE TABLE "drizzle"."__drizzle_migrations" (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
  const columns = await client.query(`SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema='drizzle' AND table_name='__drizzle_migrations' ORDER BY ordinal_position`);
  const signature = columns.rows.map((row) => [String(row.column_name), String(row.data_type), String(row.is_nullable)]);
  const expected = [["id", "integer", "NO"], ["hash", "text", "NO"], ["created_at", "bigint", "YES"]];
  if (JSON.stringify(signature) !== JSON.stringify(expected)) throw new Error("MIGRATION_LEDGER_CONTRACT_MISMATCH: drizzle migration table drift");
  const primaryKey = await client.query(`SELECT array_agg(att.attname::text ORDER BY key.position) AS columns FROM pg_catalog.pg_constraint con JOIN pg_catalog.pg_class rel ON rel.oid=con.conrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=rel.relnamespace CROSS JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS key(attnum, position) JOIN pg_catalog.pg_attribute att ON att.attrelid=rel.oid AND att.attnum=key.attnum WHERE ns.nspname='drizzle' AND rel.relname='__drizzle_migrations' AND con.contype='p'`);
  if (JSON.stringify(primaryKey.rows[0]?.columns ?? []) !== JSON.stringify(["id"])) throw new Error("MIGRATION_LEDGER_CONTRACT_MISMATCH: migration ledger primary key drift");
  return (await client.query(`SELECT hash, created_at FROM "drizzle"."__drizzle_migrations"${lock ? " FOR UPDATE" : ""}`)).rows;
}

try {
  if (mode === "apply") {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", ["ink-admin-memory:drizzle-migrations"]);
    const status = migrationStatus(plan, await migrationLedgerState(true, true));
    for (const migration of status.pending) {
      for (const statement of migration.statements) await client.query(statement);
      await client.query(`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)`, [migration.hash, migration.createdAt]);
      console.log(`Applied migration ${migration.tag}`);
    }
    await client.query("COMMIT");
    console.log(`Generated database migrations applied successfully (${connection.source})`);
  } else {
    await client.query("BEGIN READ ONLY");
    const status = migrationStatus(plan, await migrationLedgerState(false));
    const receipt = {
      status: status.pending.length === 0 ? "current" : "pending",
      appliedCount: status.appliedCount,
      targetCount: status.targetCount,
      availableCount: status.availableCount,
      pendingTags: status.pending.map((migration) => migration.tag),
      latestApplied: status.latestApplied,
      latestTarget: status.latestTarget,
      latestAvailable: status.latestAvailable,
      source: connection.source,
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
  await connection.stop();
}
