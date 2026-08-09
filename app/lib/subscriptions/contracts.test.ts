import { describe, expect, it } from "vitest";
import {
  entitlementCreateSchema,
  planCreateSchema,
  planVersionCreateSchema,
  publishVersionSchema,
  subscriptionActionSchema,
} from "./contracts";

describe("subscription contracts", () => {
  it("accepts only the monthly Token allowance and trial/grace rules", () => {
    expect(
      planVersionCreateSchema.parse({
        planId: "plan_pro",
        allowanceTokens: 1_000_000,
        trialDays: 7,
        gracePeriodDays: 3,
      }),
    ).toEqual({
      planId: "plan_pro",
      priceMicrousd: 0,
      allowanceTokens: 1_000_000,
      trialDays: 7,
      gracePeriodDays: 3,
    });
  });

  it("accepts an integer micro-USD monthly price without adding money allowance", () => {
    expect(planVersionCreateSchema.parse({
      planId: "plan_pro",
      priceMicrousd: 19_000_000,
      allowanceTokens: 1_000_000,
    }).priceMicrousd).toBe(19_000_000);
  });

  it.each([
    ["billingPeriod", "monthly"],
    ["basePriceMicrousd", 19_000_000],
    ["allowanceMicrousd", 5_000_000],
    ["overagePolicy", "cash_balance"],
    ["effectiveFrom", "2026-08-01T00:00:00.000Z"],
  ])("rejects legacy plan-version field %s", (field, value) => {
    expect(() => planVersionCreateSchema.parse({
      planId: "plan_pro",
      allowanceTokens: 1_000_000,
      [field]: value,
    })).toThrow();
  });

  it("rejects currency on the plan and a global effective date on publish", () => {
    expect(() => planCreateSchema.parse({
      code: "pro",
      name: "Pro",
      currency: "USD",
    })).toThrow();
    expect(() => publishVersionSchema.parse({
      idempotencyKey: "publish:planv_1:2026-08",
      reason: "Publish the reviewed Token policy",
      effectiveFrom: "2026-08-01T00:00:00.000Z",
    })).toThrow();
  });

  it("rejects a non-positive Token allowance and unknown Gateway scopes", () => {
    expect(() => planVersionCreateSchema.parse({
      planId: "plan_pro",
      allowanceTokens: 0,
    })).toThrow();
    expect(() =>
      entitlementCreateSchema.parse({
        planVersionId: "planv_1",
        modelId: "model_1",
        gatewayScopes: ["admin:all"],
      }),
    ).toThrow();
  });

  it("requires auditable idempotency and reason for lifecycle commands", () => {
    expect(() =>
      subscriptionActionSchema.parse({
        idempotencyKey: "short",
        reason: "ok",
        expectedVersion: 1,
      }),
    ).toThrow();
    expect(
      subscriptionActionSchema.parse({
        idempotencyKey: "renew:user-1:2026-08",
        reason: "Scheduled renewal",
        expectedVersion: 7,
      }),
    ).toMatchObject({ reason: "Scheduled renewal", expectedVersion: 7 });
  });

  it("requires a positive optimistic version for every lifecycle mutation", () => {
    expect(() =>
      subscriptionActionSchema.parse({
        idempotencyKey: "pause:user-1:2026-08",
        reason: "Pause requested by the user",
      }),
    ).toThrow();
    expect(() =>
      subscriptionActionSchema.parse({
        idempotencyKey: "pause:user-1:2026-08",
        reason: "Pause requested by the user",
        expectedVersion: 0,
      }),
    ).toThrow();
  });
});
