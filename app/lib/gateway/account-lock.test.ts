// [Input] A controlled PostgreSQL client boundary and platform user identity.
// [Output] Stable, transaction-scoped Gateway account-lock namespace evidence.
// [Pos] Provider-free unit contract for the cross-process pessimistic lock helper.
// [Sync] 2026-10-03: cover the account advisory lock key and SQL primitive.

import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { lockGatewayAccountOnClient } from "./account-lock";

describe("Gateway account transaction lock", () => {
  it("uses a namespaced PostgreSQL transaction advisory lock", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });

    await lockGatewayAccountOnClient(
      { query } as unknown as PoolClient,
      "usr_01",
    );

    expect(query).toHaveBeenCalledWith(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      ["ink-memory:gateway-account", "usr_01"],
    );
  });
});
