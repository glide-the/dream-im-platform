import { Pool, type PoolClient } from "pg";
import { getPool } from "../db";
import { AdminError } from "../admin/errors";

type StorySourceGlobal = typeof globalThis & {
  __ink_memory_story_pg_pool__?: Pool;
};

function validatedStoryDatabaseUrl() {
  const value = process.env.STORY_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!value) {
    throw new AdminError(
      "STORY_SOURCE_NOT_CONFIGURED",
      "The Story PostgreSQL data source is not configured",
      503,
    );
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AdminError(
      "STORY_SOURCE_CONFIGURATION_INVALID",
      "STORY_DATABASE_URL must be a valid PostgreSQL URL",
      503,
    );
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
    throw new AdminError(
      "STORY_SOURCE_CONFIGURATION_INVALID",
      "The Story data source must use PostgreSQL",
      503,
    );
  }
  if (url.pathname.replace(/^\//, "") !== "ink-memory") {
    throw new AdminError(
      "STORY_SOURCE_CONFIGURATION_INVALID",
      "The Story PostgreSQL database name must be ink-memory",
      503,
    );
  }
  return value;
}

/**
 * PostgreSQL-only Story domain connection.
 *
 * When STORY_DATABASE_URL is omitted, Story and control-plane tables are
 * expected in the same `ink-memory` database and the shared pool is reused.
 * There is intentionally no SQLite, file, JSON, or in-memory fallback.
 */
export function getStoryPool() {
  const connectionString = validatedStoryDatabaseUrl();
  if (
    !process.env.STORY_DATABASE_URL ||
    process.env.STORY_DATABASE_URL === process.env.DATABASE_URL
  ) {
    return getPool();
  }

  const globalPool = globalThis as StorySourceGlobal;
  globalPool.__ink_memory_story_pg_pool__ ??= new Pool({
    connectionString,
    max: Number(process.env.PGPOOL_MAX ?? 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS ?? 30_000),
    connectionTimeoutMillis: Number(
      process.env.PG_CONNECTION_TIMEOUT_MS ?? 10_000,
    ),
  });
  return globalPool.__ink_memory_story_pg_pool__;
}

export async function withStoryClient<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  const client = await getStoryPool().connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
}

export async function withStoryTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  return await withStoryClient(async (client) => {
    await client.query("BEGIN");
    try {
      const result = await handler(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export async function closeStoryPoolForTests() {
  const globalPool = globalThis as StorySourceGlobal;
  const pool = globalPool.__ink_memory_story_pg_pool__;
  globalPool.__ink_memory_story_pg_pool__ = undefined;
  if (pool) await pool.end();
}
