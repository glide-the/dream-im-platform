import type { PoolClient } from "pg";
import { getPool } from "../db";

/**
 * Story and control-plane repositories use the same PostgreSQL ink-memory
 * database and the same pool. Repository separation expresses domain rules,
 * not a second physical data source. There is no SQLite or other fallback.
 */
export function getStoryPool() {
  return getPool();
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
