import { describe, expect, it } from "vitest";
import { calculateCharge, estimateReservation } from "./money";
import type { PricingSnapshot, TokenUsage } from "./types";

const pricing: PricingSnapshot = {
  inputPriceMicrousdPerMillion: 3_000_000,
  outputPriceMicrousdPerMillion: 15_000_000,
  cacheReadPriceMicrousdPerMillion: 300_000,
  cacheWritePriceMicrousdPerMillion: 3_750_000,
  markupBps: 0,
  discountBps: 0,
};

describe("calculateCharge", () => {
  it("calculates Anthropic fresh-input and cache buckets independently", () => {
    const usage: TokenUsage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      inputTokenSemantics: "fresh",
    };

    expect(calculateCharge(usage, pricing)).toEqual({
      billableInputTokens: 1_000,
      inputCostMicrousd: 3_000,
      outputCostMicrousd: 7_500,
      cacheReadCostMicrousd: 60,
      cacheWriteCostMicrousd: 375,
      providerCostMicrousd: 10_935,
      chargedMicrousd: 10_935,
    });
  });

  it("does not double bill cached OpenAI input", () => {
    const usage: TokenUsage = {
      inputTokens: 1_000,
      outputTokens: 500,
      cacheReadTokens: 200,
      cacheWriteTokens: 100,
      inputTokenSemantics: "total_including_cache",
    };

    const result = calculateCharge(usage, pricing);
    expect(result.billableInputTokens).toBe(700);
    expect(result.providerCostMicrousd).toBe(10_035);
  });

  it("applies markup then discount with deterministic integer rounding", () => {
    const result = calculateCharge(
      {
        inputTokens: 1,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        inputTokenSemantics: "fresh",
      },
      {
        ...pricing,
        inputPriceMicrousdPerMillion: 1,
        markupBps: 2_500,
        discountBps: 2_000,
      },
    );

    expect(result.providerCostMicrousd).toBe(1);
    expect(result.chargedMicrousd).toBe(2);
  });

  it("rejects invalid financial inputs", () => {
    expect(() =>
      calculateCharge(
        {
          inputTokens: -1,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          inputTokenSemantics: "fresh",
        },
        pricing,
      ),
    ).toThrow("inputTokens");

    expect(() =>
      calculateCharge(
        {
          inputTokens: 1,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          inputTokenSemantics: "fresh",
        },
        { ...pricing, discountBps: 10_001 },
      ),
    ).toThrow("discountBps");
  });
});

describe("estimateReservation", () => {
  it("reserves the conservative max-output estimate and minimum floor", () => {
    expect(
      estimateReservation({
        estimatedInputTokens: 1_000,
        maxOutputTokens: 2_000,
        pricing,
      }),
    ).toBe(33_000);

    expect(
      estimateReservation({
        estimatedInputTokens: 0,
        maxOutputTokens: 0,
        pricing,
        minimumReserveMicrousd: 50_000,
      }),
    ).toBe(50_000);
  });
});
