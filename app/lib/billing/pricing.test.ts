import { describe, expect, it } from "vitest";
import { selectPricingRule } from "./pricing";
import type { EffectivePricingRule } from "./types";

function rule(
  id: string,
  userTier: string,
  effectiveFrom: string,
  overrides: Partial<EffectivePricingRule> = {},
): EffectivePricingRule {
  return {
    id,
    modelId: "model_1",
    userTier,
    status: "active",
    effectiveFrom: new Date(effectiveFrom),
    effectiveTo: null,
    inputPriceMicrousdPerMillion: 1,
    outputPriceMicrousdPerMillion: 1,
    cacheReadPriceMicrousdPerMillion: 0,
    cacheWritePriceMicrousdPerMillion: 0,
    markupBps: 0,
    discountBps: 0,
    ...overrides,
  };
}

describe("selectPricingRule", () => {
  const at = new Date("2026-08-08T00:00:00Z");

  it("prefers the newest effective exact-tier rule", () => {
    const selected = selectPricingRule(
      [
        rule("default", "default", "2026-01-01T00:00:00Z"),
        rule("old-pro", "pro", "2026-02-01T00:00:00Z"),
        rule("new-pro", "pro", "2026-07-01T00:00:00Z"),
      ],
      "pro",
      at,
    );
    expect(selected?.id).toBe("new-pro");
  });

  it("falls back to default and ignores inactive, future, and expired rules", () => {
    const selected = selectPricingRule(
      [
        rule("inactive", "pro", "2026-01-01T00:00:00Z", {
          status: "inactive",
        }),
        rule("future", "pro", "2027-01-01T00:00:00Z"),
        rule("expired", "pro", "2026-01-01T00:00:00Z", {
          effectiveTo: new Date("2026-02-01T00:00:00Z"),
        }),
        rule("default", "default", "2026-03-01T00:00:00Z"),
      ],
      "pro",
      at,
    );
    expect(selected?.id).toBe("default");
  });

  it("returns null when no explicit price is available", () => {
    expect(selectPricingRule([], "free", at)).toBeNull();
  });
});
