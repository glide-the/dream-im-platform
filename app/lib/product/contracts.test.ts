import { describe, expect, it } from "vitest";
import {
  idempotencyKeySchema,
  plansQuerySchema,
  subscriptionCommandSchema,
  usageQuerySchema,
} from "./contracts";
import { productActions } from "./types";

describe("Product API input contracts", () => {
  it("rejects identity and unknown fields in read queries", () => {
    expect(() =>
      plansQuerySchema.parse({ page: "1", pageSize: "20", userId: "7" }),
    ).toThrow();
    expect(() =>
      usageQuerySchema.parse({ page: "1", platformUserId: "usr_7" }),
    ).toThrow();
  });

  it("accepts exactly the eight preview actions with their required target", () => {
    for (const action of productActions) {
      const targetPlanVersionId = ["create", "upgrade", "downgrade"].includes(
        action,
      )
        ? "planv_target"
        : undefined;
      const expectedVersion = action === "create" ? null : 7;
      expect(
        subscriptionCommandSchema.parse({
          action,
          phase: "preview",
          ...(targetPlanVersionId ? { targetPlanVersionId } : {}),
          expectedVersion,
        }),
      ).toMatchObject({ action, phase: "preview" });
    }
  });

  it("requires an exact receipt for execute and rejects hidden user input", () => {
    const valid = {
      action: "upgrade",
      phase: "execute",
      targetPlanVersionId: "planv_target",
      expectedVersion: 7,
      previewId: `preview_${"a".repeat(22)}`,
      digest: `sha256:${"b".repeat(43)}`,
      expiresAt: "2030-01-01T00:00:00.000Z",
      reason: "User confirmed the next-period change",
    };
    expect(subscriptionCommandSchema.parse(valid)).toEqual(valid);
    expect(() =>
      subscriptionCommandSchema.parse({ ...valid, userId: "7" }),
    ).toThrow();
    expect(() =>
      subscriptionCommandSchema.parse({
        ...valid,
        action: "pause",
      }),
    ).toThrow();
  });

  it("does not trim machine identifiers but trims the human command reason", () => {
    expect(() =>
      usageQuerySchema.parse({ modelAlias: " dream-balanced " }),
    ).toThrow();
    expect(() =>
      subscriptionCommandSchema.parse({
        action: "create",
        phase: "preview",
        targetPlanVersionId: " planv_target ",
        expectedVersion: null,
      }),
    ).toThrow();
    expect(() => idempotencyKeySchema.parse(" command-key-123 ")).toThrow();

    const parsed = subscriptionCommandSchema.parse({
      action: "pause",
      phase: "execute",
      expectedVersion: 7,
      previewId: `preview_${"a".repeat(22)}`,
      digest: `sha256:${"b".repeat(43)}`,
      expiresAt: "2030-01-01T00:00:00.000Z",
      reason: "  User confirmed pause  ",
    });
    if (parsed.phase !== "execute") throw new Error("unexpected phase");
    expect(parsed.reason).toBe("User confirmed pause");
  });
});
