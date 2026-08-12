// Domain contract tests for subscription idempotency and conflict classification.
import { describe, expect, it } from "vitest";

import { subscriptionError, subscriptionRequestDigest } from "./service";

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
