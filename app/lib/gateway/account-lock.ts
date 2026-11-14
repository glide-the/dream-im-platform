// [Input] PostgreSQL transaction client and authenticated platform user identity.
// [Output] Transaction-scoped, cross-process serialization for Gateway accounting mutations.
// [Pos] Gateway concurrency boundary acquired before request, rate, allowance or billing row locks.
// [Sync] 2026-11-14: observe wait and transaction-held time without changing lock ownership or order.
// [Sync] 2026-10-03: add one pessimistic account gate for preauthorization, settlement and reconciliation.

import type { PoolClient } from "pg";
import { observeAccountLock, observeCapacityOperation } from "../observability/capacity";

const GATEWAY_ACCOUNT_LOCK_NAMESPACE = "ink-memory:gateway-account";

/**
 * Serializes the short database accounting sections for one platform user.
 * PostgreSQL releases this advisory lock automatically on commit or rollback.
 */
export async function lockGatewayAccountOnClient(
  client: PoolClient,
  platformUserId: string,
) {
  await observeCapacityOperation("account_lock_wait", () => client.query(
    "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
    [GATEWAY_ACCOUNT_LOCK_NAMESPACE, platformUserId],
  ));
  observeAccountLock(client);
}
