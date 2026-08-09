import { describe, expect, it } from "vitest";

import { subscriptionRequestDigest } from "./service";

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
