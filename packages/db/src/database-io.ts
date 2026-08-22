// [Input] A gzip-compressed plain SQL dump plus a supervisor-injected local database DSN.
// [Output] Guarded restore into an empty embedded PostgreSQL database.
// [Pos] First-release data import command for @ink-memory/db; never overwrites non-empty targets.
// [Sync] 2026-08-21: stream portable plain SQL through psql after an empty-target guard.
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import pg from "pg";

const [command, dumpPath] = process.argv.slice(2);
if (command !== "restore-sql-gzip" || !dumpPath) {
  throw new Error("Usage: node database-io.js restore-sql-gzip <plain-sql-dump.gz>");
}
if ((await stat(dumpPath)).size <= 0) throw new Error("Restore dump is empty.");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for restore.");
const url = new URL(connectionString);
const client = new pg.Client({ connectionString });
await client.connect();
try {
  const result = await client.query(`SELECT count(*)::int AS count FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`);
  if (Number(result.rows[0]?.count) !== 0) {
    throw new Error(`Restore target is not empty (${String(result.rows[0]?.count)} user tables).`);
  }
} finally {
  await client.end();
}

const restore = spawn("psql", [
  "--no-psqlrc",
  "--single-transaction",
  "--set=ON_ERROR_STOP=1",
], {
  stdio: ["pipe", "inherit", "inherit"],
  env: {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: url.port || "5432",
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, "")),
  },
});
const exitPromise = new Promise<number>((resolve, reject) => {
  restore.on("error", reject);
  restore.on("exit", (code) => resolve(code ?? 1));
});
const [exitCode] = await Promise.all([
  exitPromise,
  pipeline(createReadStream(dumpPath), createGunzip(), restore.stdin),
]);
if (exitCode !== 0) throw new Error(`psql exited with code ${exitCode}.`);
console.log("Compressed plain SQL restored into the empty embedded PostgreSQL database.");
