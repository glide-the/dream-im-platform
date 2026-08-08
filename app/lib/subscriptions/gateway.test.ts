import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import {
  resolveGatewaySubscriptionOnClient,
  settleSubscriptionAllowanceOnClient,
} from "./gateway";

function clientWith(query: ReturnType<typeof vi.fn>) {
  return { query } as unknown as PoolClient;
}

const baseRow = {
  subscription_id: "sub_1",
  plan_version_id: "planv_1",
  subscription_status: "active",
  current_period_start: new Date("2026-08-01T00:00:00.000Z"),
  current_period_end: new Date("2026-09-01T00:00:00.000Z"),
  trial_ends_at: null,
  grace_ends_at: null,
  billing_period: "monthly",
  overage_policy: "deny",
  entitlement_id: "ent_1",
  gateway_scopes: ["messages:create"],
  requests_per_minute: 10,
  daily_token_limit: 100_000,
  monthly_token_limit: 1_000_000,
  allowance_id: "allow_1",
  granted_tokens: 100_000,
  reserved_tokens: 1_000,
  consumed_tokens: 20_000,
  granted_microusd: 0,
  reserved_microusd: 0,
  consumed_microusd: 0,
};

describe("subscription Gateway eligibility", () => {
  it("reserves token allowance before cash", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [baseRow] });
    const result = await resolveGatewaySubscriptionOnClient(
      clientWith(query),
      {
        platformUserId: "user_1",
        modelId: "model_1",
        requiredScope: "messages:create",
        estimatedTokens: 10_000,
        reservationMicrousd: 50_000,
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      coverageMode: "token_allowance",
      allowanceReservedTokens: 10_000,
      cashReservedMicrousd: 0,
    });
  });

  it("rejects paused subscriptions before Provider dispatch", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ ...baseRow, subscription_status: "paused" }],
    });
    const result = await resolveGatewaySubscriptionOnClient(
      clientWith(query),
      {
        platformUserId: "user_1",
        modelId: "model_1",
        requiredScope: "messages:create",
        estimatedTokens: 1_000,
        reservationMicrousd: 10_000,
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({ code: "SUBSCRIPTION_PAUSED", status: 403 });
  });

  it("returns 402 when allowance is exhausted and overage is denied", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        ...baseRow,
        granted_tokens: 20_000,
        reserved_tokens: 0,
        consumed_tokens: 20_000,
        overage_policy: "deny",
      }],
    });
    const result = await resolveGatewaySubscriptionOnClient(
      clientWith(query),
      {
        platformUserId: "user_1",
        modelId: "model_1",
        requiredScope: "messages:create",
        estimatedTokens: 1_000,
        reservationMicrousd: 10_000,
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      code: "SUBSCRIPTION_ALLOWANCE_EXHAUSTED",
      status: 402,
    });
  });

  it("falls through to cash reservation when overage is enabled", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        ...baseRow,
        granted_tokens: 20_000,
        reserved_tokens: 0,
        consumed_tokens: 20_000,
        overage_policy: "cash_balance",
      }],
    });
    const result = await resolveGatewaySubscriptionOnClient(
      clientWith(query),
      {
        platformUserId: "user_1",
        modelId: "model_1",
        requiredScope: "messages:create",
        estimatedTokens: 1_000,
        reservationMicrousd: 10_000,
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      coverageMode: "cash_only",
      allowanceReservedTokens: 0,
      cashReservedMicrousd: 10_000,
    });
  });

  it("captures money allowance and releases the unused reservation", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          granted_tokens: 0,
          reserved_tokens: 0,
          consumed_tokens: 0,
          granted_microusd: 100_000,
          reserved_microusd: 50_000,
          consumed_microusd: 10_000,
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const result = await settleSubscriptionAllowanceOnClient(
      clientWith(query),
      {
        allowanceId: "allow_1",
        coverageMode: "money_allowance",
        reservedTokens: 0,
        reservedMicrousd: 50_000,
        actualTokens: 2_000,
        chargeMicrousd: 30_000,
      },
    );
    expect(result).toEqual({
      cashChargeMicrousd: 0,
      allowanceChargeMicrousd: 30_000,
      allowanceChargedTokens: 0,
    });
    expect(query.mock.calls[1][1]).toEqual([
      "allow_1",
      0,
      0,
      50_000,
      30_000,
    ]);
  });
});
