import type { PoolClient } from "pg";
import { getPool } from "./db";

let schemaCheck: Promise<void> | undefined;

export class PlatformSchemaNotReadyError extends Error {
  readonly code = "PLATFORM_SCHEMA_NOT_READY";

  constructor() {
    super(
      "AI platform schema is not installed. Run `pnpm db:migrate` before enabling Admin billing or the gateway.",
    );
    this.name = "PlatformSchemaNotReadyError";
  }
}

export async function assertPlatformSchema() {
  if (!schemaCheck) {
    schemaCheck = getPool()
      .query<{
        users: string | null;
        requests: string | null;
        ledger: string | null;
      }>(
        `SELECT
          to_regclass('public.platform_users')::text AS users,
          to_regclass('public.gateway_requests')::text AS requests,
          to_regclass('public.billing_ledger_entries')::text AS ledger`,
      )
      .then(({ rows }) => {
        const row = rows[0];
        if (!row?.users || !row.requests || !row.ledger) {
          throw new PlatformSchemaNotReadyError();
        }
      })
      .catch((error) => {
        schemaCheck = undefined;
        throw error;
      });
  }
  await schemaCheck;
}

export async function withPlatformClient<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  await assertPlatformSchema();
  const client = await getPool().connect();
  try {
    return await handler(client);
  } finally {
    client.release();
  }
}

export async function withPlatformTransaction<T>(
  handler: (client: PoolClient) => Promise<T>,
) {
  return await withPlatformClient(async (client) => {
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

export function resetPlatformSchemaCheckForTests() {
  schemaCheck = undefined;
}
