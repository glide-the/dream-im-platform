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
  entitlement_id: "ent_1",
  gateway_scopes: ["messages:create"],
  requests_per_minute: 10,
  daily_token_limit: 100_000,
  monthly_token_limit: 1_000_000,
  allowance_id: "allow_1",
  granted_tokens: 100_000,
  bonus_granted_tokens: 0,
  reserved_tokens: 1_000,
  consumed_tokens: 20_000,
};

describe("subscription Gateway eligibility", () => {
  it("fails closed when a canonical user has no subscription", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const result = await resolveGatewaySubscriptionOnClient(
      clientWith(query),
      {
        platformUserId: "user_1",
        modelId: "model_1",
        requiredScope: "messages:create",
        estimatedTokens: 1_000,
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toEqual({
      code: "SUBSCRIPTION_REQUIRED",
      status: 403,
      message: "An active Token subscription is required for Gateway access",
    });
  });

  it("reserves only the current subscription-period Token allowance", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [baseRow] });
    const result = await resolveGatewaySubscriptionOnClient(
      clientWith(query),
      {
        platformUserId: "user_1",
        modelId: "model_1",
        requiredScope: "messages:create",
        estimatedTokens: 10_000,
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      coverageMode: "token_allowance",
      allowanceReservedTokens: 10_000,
    });
    expect(result).not.toHaveProperty("cashReservedMicrousd");
    expect(result).not.toHaveProperty("allowanceReservedMicrousd");
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
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({ code: "SUBSCRIPTION_PAUSED", status: 403 });
  });

  it("rejects a future personal subscription period before Provider dispatch", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        ...baseRow,
        current_period_start: new Date("2026-08-09T00:00:00.000Z"),
        current_period_end: new Date("2026-09-09T00:00:00.000Z"),
      }],
    });
    const result = await resolveGatewaySubscriptionOnClient(
      clientWith(query),
      {
        platformUserId: "user_1",
        modelId: "model_1",
        requiredScope: "messages:create",
        estimatedTokens: 1_000,
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      code: "SUBSCRIPTION_PERIOD_NOT_STARTED",
      status: 403,
    });
  });

  it("returns a Token-specific 402 when the period allowance is exhausted", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        ...baseRow,
        granted_tokens: 20_000,
        reserved_tokens: 0,
        consumed_tokens: 20_000,
      }],
    });
    const result = await resolveGatewaySubscriptionOnClient(
      clientWith(query),
      {
        platformUserId: "user_1",
        modelId: "model_1",
        requiredScope: "messages:create",
        estimatedTokens: 1_000,
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      code: "SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED",
      status: 402,
      metric: "tokens",
      unit: "tokens",
      availableTokens: 0,
      requiredTokens: 1_000,
      periodEnd: "2026-09-01T00:00:00.000Z",
    });
  });

  it("includes audited bonus grants in the reservable current-period allowance", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{
        ...baseRow,
        granted_tokens: 1,
        bonus_granted_tokens: 1_000,
        reserved_tokens: 0,
        consumed_tokens: 15,
      }],
    });
    const result = await resolveGatewaySubscriptionOnClient(
      clientWith(query),
      {
        platformUserId: "user_1",
        modelId: "model_1",
        requiredScope: "messages:create",
        estimatedTokens: 100,
        at: new Date("2026-08-08T00:00:00.000Z"),
      },
    );
    expect(result).toMatchObject({
      coverageMode: "token_allowance",
      allowanceReservedTokens: 100,
    });
  });

  it("settles Token usage without charging cash or a monetary allowance", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          subscription_id: "sub_1",
          plan_version_id: "planv_1",
          granted_tokens: 100_000,
          reserved_tokens: 10_000,
          consumed_tokens: 20_000,
          granted_microusd: 0,
          reserved_microusd: 0,
          consumed_microusd: 0,
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const result = await settleSubscriptionAllowanceOnClient(
      clientWith(query),
      {
        allowanceId: "allow_1",
        coverageMode: "token_allowance",
        reservedTokens: 10_000,
        reservedMicrousd: 0,
        actualTokens: 2_000,
        chargeMicrousd: 30_000,
        gatewayRequestId: "req_1",
        platformUserId: "user_1",
        subscriptionId: "sub_1",
        planVersionId: "planv_1",
      },
    );
    expect(result).toEqual({
      cashChargeMicrousd: 0,
      allowanceChargeMicrousd: 0,
      allowanceChargedTokens: 2_000,
    });
    expect(query.mock.calls[1][1]).toEqual(["allow_1", 10_000, 2_000]);
    expect(String(query.mock.calls[2][0])).toContain(
      "subscription_token_ledger_entries",
    );
    expect(query.mock.calls[2][1]).toEqual(
      expect.arrayContaining(["req_1", "capture", 2_000, "req_1:token:capture"]),
    );
    expect(query.mock.calls[3][1]).toEqual(
      expect.arrayContaining(["req_1", "release", 8_000, "req_1:token:release"]),
    );
  });

  it("clamps underestimated Token usage and releases the full request reservation", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          subscription_id: "sub_1",
          plan_version_id: "planv_1",
          granted_tokens: 100_000,
          reserved_tokens: 20_000,
          consumed_tokens: 70_000,
          granted_microusd: 0,
          reserved_microusd: 0,
          consumed_microusd: 0,
        }],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const result = await settleSubscriptionAllowanceOnClient(
      clientWith(query),
      {
        allowanceId: "allow_1",
        coverageMode: "token_allowance",
        reservedTokens: 10_000,
        reservedMicrousd: 0,
        actualTokens: 30_000,
        chargeMicrousd: 50_000,
        gatewayRequestId: "req_2",
        platformUserId: "user_1",
        subscriptionId: "sub_1",
        planVersionId: "planv_1",
      },
    );
    expect(result).toEqual({
      cashChargeMicrousd: 0,
      allowanceChargeMicrousd: 0,
      allowanceChargedTokens: 20_000,
    });
    expect(query.mock.calls[1][1]).toEqual(["allow_1", 10_000, 20_000]);
    expect(query.mock.calls[2][1]).toEqual(
      expect.arrayContaining(["req_2", "capture", 20_000, "req_2:token:capture"]),
    );
    expect(query).toHaveBeenCalledTimes(3);
  });

  it("settles only a legacy in-flight money reservation during rolling deploy", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{
          subscription_id: "sub_1",
          plan_version_id: "planv_1",
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
      50_000,
      30_000,
    ]);
  });
});
