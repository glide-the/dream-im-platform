import { Pool } from "pg";

type GlobalPool = typeof globalThis & {
  __ink_memory_pg_pool__?: Pool;
};

function validatedDatabaseUrl() {
  const value = process.env.DATABASE_URL;
  if (!value) {
    throw new Error(
      "DATABASE_URL is required and must point to the PostgreSQL ink-memory database.",
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error("DATABASE_URL must use PostgreSQL.");
  }
  if (url.pathname.replace(/^\//, "") !== "ink-memory") {
    throw new Error("DATABASE_URL must use the ink-memory database.");
  }
  return value;
}

/**
 * Shared PostgreSQL connection pool for the Ink Memory control plane.
 *
 * The application intentionally has no embedded database fallback: operators
 * must configure the single DATABASE_URL before startup. Story and control-plane
 * repositories intentionally share this pool and the same ink-memory database.
 */
export function getPool() {
  const globalPool = globalThis as GlobalPool;
  if (globalPool.__ink_memory_pg_pool__) {
    return globalPool.__ink_memory_pg_pool__;
  }

  const connectionString = validatedDatabaseUrl();

  globalPool.__ink_memory_pg_pool__ = new Pool({
    connectionString,
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
