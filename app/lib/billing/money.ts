import type {
  ChargeBreakdown,
  PricingSnapshot,
  TokenUsage,
} from "./types";

const TOKENS_PER_MILLION = 1_000_000n;
const BASIS_POINTS = 10_000n;

function assertNonNegativeSafeInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`);
  }
}

function toSafeNumber(value: bigint, name: string) {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${name} exceeds Number.MAX_SAFE_INTEGER`);
  }
  return Number(value);
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  if (numerator === 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

function tokenComponent(tokens: number, priceMicrousdPerMillion: number) {
  assertNonNegativeSafeInteger(tokens, "tokens");
  assertNonNegativeSafeInteger(
    priceMicrousdPerMillion,
    "priceMicrousdPerMillion",
  );
  return ceilDiv(
    BigInt(tokens) * BigInt(priceMicrousdPerMillion),
    TOKENS_PER_MILLION,
  );
}

function validateUsage(usage: TokenUsage) {
  assertNonNegativeSafeInteger(usage.inputTokens, "inputTokens");
  assertNonNegativeSafeInteger(usage.outputTokens, "outputTokens");
  assertNonNegativeSafeInteger(usage.cacheReadTokens, "cacheReadTokens");
  assertNonNegativeSafeInteger(usage.cacheWriteTokens, "cacheWriteTokens");
}

function validatePricing(pricing: PricingSnapshot) {
  assertNonNegativeSafeInteger(
    pricing.inputPriceMicrousdPerMillion,
    "inputPriceMicrousdPerMillion",
  );
  assertNonNegativeSafeInteger(
    pricing.outputPriceMicrousdPerMillion,
    "outputPriceMicrousdPerMillion",
  );
  assertNonNegativeSafeInteger(
    pricing.cacheReadPriceMicrousdPerMillion,
    "cacheReadPriceMicrousdPerMillion",
  );
  assertNonNegativeSafeInteger(
    pricing.cacheWritePriceMicrousdPerMillion,
    "cacheWritePriceMicrousdPerMillion",
  );
  assertNonNegativeSafeInteger(pricing.markupBps, "markupBps");
  assertNonNegativeSafeInteger(pricing.discountBps, "discountBps");
  if (pricing.discountBps > 10_000) {
    throw new RangeError("discountBps must not exceed 10000");
  }
}

/**
 * Calculate one immutable request charge in integer micro-USD.
 *
 * Anthropic usage reports fresh input separately from cache buckets. OpenAI
 * usage reports input inclusive of cached tokens, so those buckets are removed
 * before the normal input component is priced.
 */
export function calculateCharge(
  usage: TokenUsage,
  pricing: PricingSnapshot,
): ChargeBreakdown {
  validateUsage(usage);
  validatePricing(pricing);

  const cachedInput = usage.cacheReadTokens + usage.cacheWriteTokens;
  const billableInputTokens =
    usage.inputTokenSemantics === "total_including_cache"
      ? Math.max(0, usage.inputTokens - cachedInput)
      : usage.inputTokens;

  const inputCost = tokenComponent(
    billableInputTokens,
    pricing.inputPriceMicrousdPerMillion,
  );
  const outputCost = tokenComponent(
    usage.outputTokens,
    pricing.outputPriceMicrousdPerMillion,
  );
  const cacheReadCost = tokenComponent(
    usage.cacheReadTokens,
    pricing.cacheReadPriceMicrousdPerMillion,
  );
  const cacheWriteCost = tokenComponent(
    usage.cacheWriteTokens,
    pricing.cacheWritePriceMicrousdPerMillion,
  );
  const providerCost =
    inputCost + outputCost + cacheReadCost + cacheWriteCost;
  const markedUp = ceilDiv(
    providerCost * (BASIS_POINTS + BigInt(pricing.markupBps)),
    BASIS_POINTS,
  );
  const charged = ceilDiv(
    markedUp * (BASIS_POINTS - BigInt(pricing.discountBps)),
    BASIS_POINTS,
  );

  return {
    billableInputTokens,
    inputCostMicrousd: toSafeNumber(inputCost, "inputCostMicrousd"),
    outputCostMicrousd: toSafeNumber(outputCost, "outputCostMicrousd"),
    cacheReadCostMicrousd: toSafeNumber(
      cacheReadCost,
      "cacheReadCostMicrousd",
    ),
    cacheWriteCostMicrousd: toSafeNumber(
      cacheWriteCost,
      "cacheWriteCostMicrousd",
    ),
    providerCostMicrousd: toSafeNumber(
      providerCost,
      "providerCostMicrousd",
    ),
    chargedMicrousd: toSafeNumber(charged, "chargedMicrousd"),
  };
}

export function estimateReservation(input: {
  estimatedInputTokens: number;
  maxOutputTokens: number;
  pricing: PricingSnapshot;
  minimumReserveMicrousd?: number;
}) {
  assertNonNegativeSafeInteger(
    input.minimumReserveMicrousd ?? 0,
    "minimumReserveMicrousd",
  );
  const estimate = calculateCharge(
    {
      inputTokens: input.estimatedInputTokens,
      outputTokens: input.maxOutputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokenSemantics: "fresh",
    },
    input.pricing,
  );
  return Math.max(
    estimate.chargedMicrousd,
    input.minimumReserveMicrousd ?? 0,
  );
}
