import { Pool } from "pg";

type GlobalPool = typeof globalThis & {
  __ink_memory_pg_pool__?: Pool;
};

function parsePort(value: string | undefined) {
  if (!value) return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error("PGPORT must be an integer between 1 and 65535.");
  }
  return port;
}

/**
 * Shared PostgreSQL connection pool for the Ink Memory control plane.
 *
 * The application intentionally has no embedded database fallback: operators
 * must configure DATABASE_URL or the standard PG* variables before startup.
 */
export function getPool() {
  const globalPool = globalThis as GlobalPool;
  if (globalPool.__ink_memory_pg_pool__) {
    return globalPool.__ink_memory_pg_pool__;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    const missing = ["PGHOST", "PGUSER", "PGDATABASE"].filter(
      (name) => !process.env[name],
    );
    if (missing.length > 0) {
      throw new Error(
        `PostgreSQL configuration missing. Set DATABASE_URL or ${missing.join(", ")}. See .env.local.example.`,
      );
    }
  }

  globalPool.__ink_memory_pg_pool__ = new Pool({
    connectionString,
    host: connectionString ? undefined : process.env.PGHOST,
    port: connectionString ? undefined : parsePort(process.env.PGPORT),
    user: connectionString ? undefined : process.env.PGUSER,
    password: connectionString ? undefined : process.env.PGPASSWORD,
    database: connectionString ? undefined : process.env.PGDATABASE,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(
      process.env.PG_CONNECTION_TIMEOUT_MS ?? 10_000,
    ),
  });

  return globalPool.__ink_memory_pg_pool__;
}

export async function closePoolForTests() {
  const globalPool = globalThis as GlobalPool;
  const pool = globalPool.__ink_memory_pg_pool__;
  globalPool.__ink_memory_pg_pool__ = undefined;
  if (pool) await pool.end();
}
