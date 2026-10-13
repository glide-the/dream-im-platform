// Domain contract tests for subscription idempotency and conflict classification.
// [Sync] 2026-10-09: cover exact PostgreSQL period preservation for non-renewal transitions.
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";

import {
  subscriptionError,
  subscriptionRequestDigest,
  transitionSubscriptionOnClient,
} from "./service";

describe("subscription request digest", () => {
  it("binds an idempotent lifecycle command to its optimistic version", () => {
    const base = {
      subscriptionId: "sub_01",
      planVersionId: null,
      reason: "Pause at the user's request",
    };

    expect(
      subscriptionRequestDigest("pause", { ...base, expectedVersion: 7 }),
    ).not.toBe(
      subscriptionRequestDigest("pause", { ...base, expectedVersion: 8 }),
    );
  });

  it("is stable when object keys arrive in a different order", () => {
    expect(
      subscriptionRequestDigest("resume", {
        subscriptionId: "sub_01",
        expectedVersion: 9,
        reason: "Resume service",
      }),
    ).toBe(
      subscriptionRequestDigest("resume", {
        reason: "Resume service",
        expectedVersion: 9,
        subscriptionId: "sub_01",
      }),
    );
  });
});

describe("subscription conflict errors", () => {
  it("identifies duplicate callable subscriptions with an actionable code", () => {
    expect(
      subscriptionError({
        code: "23505",
        constraint: "subscriptions_one_callable_user_uidx",
      }),
    ).toMatchObject({
      code: "SUBSCRIPTION_ALREADY_CALLABLE",
      status: 409,
      details: { constraint: "subscriptions_one_callable_user_uidx" },
    });
  });

  it("keeps an unknown unique constraint on the generic conflict path", () => {
    expect(
      subscriptionError({ code: "23505", constraint: "other_unique_uidx" }),
    ).toMatchObject({ code: "SUBSCRIPTION_CONFLICT", status: 409 });
  });
});

describe("subscription lifecycle writes", () => {
  it("keeps stored PostgreSQL period boundaries on a scheduled plan change", async () => {
    const stopAfterUpdate = new Error("stop after lifecycle update");
    let updateSql = "";
    let updateParameters: unknown[] = [];
    const client = {
      query: async (sql: string, parameters: unknown[] = []) => {
        if (sql.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (sql.includes("FROM subscription_events")) return { rows: [] };
        if (sql.includes("FROM subscriptions") && sql.includes("FOR UPDATE")) {
          return {
            rows: [{
              id: "sub_microseconds",
              platform_user_id: "usr_1",
              plan_version_id: "planv_current",
              pending_plan_version_id: null,
              status: "active",
              cycle_anchor_at: new Date("2026-08-09T14:18:27.437Z"),
              current_period_number: 0,
              current_period_start: new Date("2026-08-09T14:18:27.437Z"),
              current_period_end: new Date("2026-09-09T14:18:27.437Z"),
              renewal_enabled: true,
              version: 1,
            }],
          };
        }
        if (sql.includes("FROM subscription_plan_versions")) {
          return {
            rows: [{
              id: "planv_target",
              plan_id: "plan_free",
              status: "published",
              billing_period: "monthly",
              base_price_microusd: 0,
              trial_days: 0,
              allowance_tokens: 100_000_000,
              allowance_microusd: 0,
              overage_policy: "deny",
              effective_from: null,
            }],
          };
        }
        if (sql.startsWith("UPDATE subscriptions")) {
          updateSql = sql;
          updateParameters = parameters;
          throw stopAfterUpdate;
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
    } as unknown as PoolClient;

    await expect(transitionSubscriptionOnClient(client, {
      id: "sub_microseconds",
      action: "upgrade",
      actor: { type: "admin", id: "admin_1" },
      idempotencyKey: "upgrade-microseconds-1",
      reason: "Preserve exact PostgreSQL period boundaries",
      expectedVersion: 1,
      planVersionId: "planv_target",
    })).rejects.toBe(stopAfterUpdate);

    expect(updateSql).toContain(
      "current_period_start = CASE WHEN $10::boolean THEN $5 ELSE current_period_start END",
    );
    expect(updateSql).toContain(
      "current_period_end = CASE WHEN $10::boolean THEN $6 ELSE current_period_end END",
    );
    expect(updateParameters[9]).toBe(false);
  });
});
