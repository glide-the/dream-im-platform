// [Input] Supervisor-injected DATABASE_URL after a first-release logical restore.
// [Output] A value-free receipt proving the target contains imported user data.
// [Pos] AutoDL bootstrap guard between restore and forward migration.
// [Sync] 2026-08-26: prevent an empty-schema bootstrap from being accepted.
import pg from "../node_modules/pg/lib/index.js";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required for bootstrap verification.");
const client = new pg.Client({ connectionString });
await client.connect();
try {
  const users = await client.query("SELECT count(*)::int AS count FROM users");
  const tables = await client.query("SELECT count(*)::int AS count FROM pg_catalog.pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')");
  const userCount = Number(users.rows[0]?.count ?? 0);
  const tableCount = Number(tables.rows[0]?.count ?? 0);
  if (userCount <= 0 || tableCount <= 1) {
    throw new Error("Bootstrap restore did not produce the expected business data.");
  }
  console.log(JSON.stringify({ status: "imported", users: userCount, userTables: tableCount }));
} finally {
  await client.end();
}
