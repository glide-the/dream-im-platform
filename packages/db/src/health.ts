// [Input] Admin database DSN injected by the embedded PostgreSQL supervisor.
// [Output] Exit-zero connectivity and database identity health receipt.
// [Pos] Container and release verification command for @ink-memory/db.
// [Sync] 2026-08-21: add embedded database health verification.
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for database health checks.");
const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000 });
await client.connect();
try {
  const result = await client.query("SELECT current_database() AS database, pg_is_in_recovery() AS recovering");
  if (result.rows[0]?.database !== "ink-memory" || result.rows[0]?.recovering !== false) {
    throw new Error("Embedded PostgreSQL identity or recovery state is invalid.");
  }
  console.log(JSON.stringify({ status: "ok", database: "ink-memory" }));
} finally {
  await client.end();
}
