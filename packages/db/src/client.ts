// [Input] Explicit PostgreSQL application or isolated test DSN.
// [Output] Validated shared pg Pool for Admin, Gateway, Billing, and Story access.
// [Pos] Application database client owned by @ink-memory/db.
// [Sync] 2026-08-21: move pool ownership from the Next.js app into the DB package.
import { Pool } from "pg";

type GlobalPool = typeof globalThis & { __ink_memory_pg_pool__?: Pool };

function parsePostgresUrl(value: string, variableName: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol)) {
    throw new Error(`${variableName} must use PostgreSQL.`);
  }
  return url;
}

export function validatedDatabaseUrl(): string {
  if (process.env.INK_USE_TEST_DATABASE_URL === "1") {
    if (process.env.NODE_ENV === "production") throw new Error("TEST_DATABASE_URL is forbidden in production.");
    const testValue = process.env.TEST_DATABASE_URL;
    if (!testValue) throw new Error("TEST_DATABASE_URL is required when INK_USE_TEST_DATABASE_URL=1.");
    const testUrl = parsePostgresUrl(testValue, "TEST_DATABASE_URL");
    const name = decodeURIComponent(testUrl.pathname.replace(/^\//, ""));
    if (!/(?:^|[_-])(?:test|codex)(?:[_-]|$)/i.test(name)) {
      throw new Error("TEST_DATABASE_URL must name an explicitly isolated test/codex database.");
    }
    return testValue;
  }
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is required and must point to the PostgreSQL ink-memory database.");
  const url = parsePostgresUrl(value, "DATABASE_URL");
  if (decodeURIComponent(url.pathname.replace(/^\//, "")) !== "ink-memory") {
    throw new Error("DATABASE_URL must use the ink-memory database.");
  }
  return value;
}

export function getPool(): Pool {
  const globalPool = globalThis as GlobalPool;
  if (globalPool.__ink_memory_pg_pool__) return globalPool.__ink_memory_pg_pool__;
  globalPool.__ink_memory_pg_pool__ = new Pool({
    connectionString: validatedDatabaseUrl(),
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS ?? 10_000),
  });
  return globalPool.__ink_memory_pg_pool__;
}

export async function closePoolForTests(): Promise<void> {
  const globalPool = globalThis as GlobalPool;
  const pool = globalPool.__ink_memory_pg_pool__;
  globalPool.__ink_memory_pg_pool__ = undefined;
  if (pool) await pool.end();
}
