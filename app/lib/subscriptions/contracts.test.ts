import { describe, expect, it } from "vitest";
import {
  entitlementCreateSchema,
  planVersionCreateSchema,
  subscriptionActionSchema,
} from "./contracts";

describe("subscription contracts", () => {
  it("accepts integer micro-USD and explicit overage policy", () => {
    expect(
      planVersionCreateSchema.parse({
        planId: "plan_pro",
        billingPeriod: "monthly",
        basePriceMicrousd: 19_000_000,
        allowanceTokens: 1_000_000,
        allowanceMicrousd: 5_000_000,
        overagePolicy: "cash_balance",
      }),
    ).toMatchObject({ basePriceMicrousd: 19_000_000, trialDays: 0 });
  });

  it("rejects fractional prices and unknown Gateway scopes", () => {
    expect(() =>
      planVersionCreateSchema.parse({
        planId: "plan_pro",
        billingPeriod: "monthly",
        basePriceMicrousd: 1.5,
      }),
    ).toThrow();
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
      }),
    ).toThrow();
    expect(
      subscriptionActionSchema.parse({
        idempotencyKey: "renew:user-1:2026-08",
        reason: "Scheduled renewal",
      }),
    ).toMatchObject({ reason: "Scheduled renewal" });
  });
});
