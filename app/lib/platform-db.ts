// [Input] PostgreSQL capability objects installed by explicit migrations.
// [Output] Fail-closed domain clients/transactions without startup DDL.
// [Pos] Shared platform readiness, including same-model routing evidence.
import type { PoolClient } from "pg";
import { getPool } from "./db";

let schemaCheck: Promise<void> | undefined;

export class PlatformSchemaNotReadyError extends Error {
  readonly code = "PLATFORM_SCHEMA_NOT_READY";

  constructor() {
    super(
      "Ink Memory PostgreSQL schema is not installed. Run `pnpm db:migrate` before starting the Admin console or gateway.",
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
        admin_users: string | null;
        payment_intents: string | null;
        estimated_tokens: string | null;
        routing_policies: string | null;
        routing_targets: string | null;
        routing_snapshot: string | null;
      }>(
        `SELECT
          to_regclass('public.ai_model_route_policies')::text AS routing_policies,
          to_regclass('public.ai_model_route_targets')::text AS routing_targets,
          (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public'
            AND table_name = 'gateway_requests' AND column_name = 'routing_snapshot') AS routing_snapshot,
          to_regclass('public.platform_users')::text AS users,
          to_regclass('public.gateway_requests')::text AS requests,
          to_regclass('public.billing_ledger_entries')::text AS ledger,
          to_regclass('public.admin_users')::text AS admin_users,
          to_regclass('public.subscription_payment_intents')::text AS payment_intents,
          (
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'gateway_requests'
              AND column_name = 'estimated_tokens'
          ) AS estimated_tokens`,
      )
      .then(({ rows }) => {
        const row = rows[0];
        if (
          !row?.users ||
          !row.requests ||
          !row.ledger ||
          !row.admin_users ||
          !row.payment_intents ||
          !row.estimated_tokens || !row.routing_policies || !row.routing_targets || !row.routing_snapshot
        ) {
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
