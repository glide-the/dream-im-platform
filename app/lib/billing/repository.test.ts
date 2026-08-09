import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  settleAllowance: vi.fn(),
}));

vi.mock("../subscriptions/gateway", () => ({
  settleSubscriptionAllowanceOnClient: mocks.settleAllowance,
}));

import { settleGatewayRequestOnClient } from "./repository";

describe("Token-only Gateway settlement", () => {
  it("captures subscription Tokens without locking or mutating a cash account", async () => {
    mocks.settleAllowance.mockResolvedValue({
      cashChargeMicrousd: 0,
      allowanceChargeMicrousd: 0,
      allowanceChargedTokens: 300,
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM gateway_requests")) {
        return {
          rows: [
            {
              id: "req_token_1",
              platform_user_id: "usr_1",
              model_id: "model_1",
              status: "reserved",
              outcome: "pending",
              reserved_microusd: 0,
              estimated_tokens: 1_000,
              subscription_id: "sub_1",
              subscription_plan_version_id: "planv_1",
              subscription_allowance_id: "allow_1",
              subscription_coverage_mode: "token_allowance",
              allowance_reserved_microusd: 0,
              allowance_reserved_tokens: 1_000,
              created_at: new Date("2026-08-09T00:00:00.000Z"),
              settled_at: null,
              input_price_snapshot: 1_000_000,
              output_price_snapshot: 2_000_000,
              cache_read_price_snapshot: 0,
              cache_write_price_snapshot: 0,
              markup_bps_snapshot: 0,
              discount_bps_snapshot: 0,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    const result = await settleGatewayRequestOnClient(
      { query } as unknown as PoolClient,
      {
        gatewayRequestId: "req_token_1",
        usage: {
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          inputTokenSemantics: "fresh",
        },
        outcome: "succeeded",
      },
    );

    const executedSql = query.mock.calls
      .map(([sql]) => String(sql))
      .join("\n");
    expect(executedSql).not.toContain("billing_accounts");
    expect(executedSql).not.toContain("billing_ledger_entries");
    expect(result).toMatchObject({
      idempotent: false,
      requestId: "req_token_1",
      account: null,
      overdraftMicrousd: 0,
    });
    expect(mocks.settleAllowance).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        gatewayRequestId: "req_token_1",
        platformUserId: "usr_1",
        subscriptionId: "sub_1",
        planVersionId: "planv_1",
      }),
    );
  });
});
