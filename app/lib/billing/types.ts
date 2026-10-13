// [Input] Provider protocol, reliable text/Image Token usage, and immutable pricing snapshots.
// [Output] Shared type contracts for reservation, charging, and request settlement.
// [Pos] Billing domain value types; storage and Provider parsing live at their own boundaries.
// [Sync] 2026-10-09: add optional complete Image Token details and Image price snapshots.

export type AiProviderProtocol = "anthropic" | "openai";

export type InputTokenSemantics = "fresh" | "total_including_cache";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokenSemantics: InputTokenSemantics;
  inputTextTokens?: number;
  inputImageTokens?: number;
  outputTextTokens?: number;
  outputImageTokens?: number;
  providerModel?: string;
  upstreamRequestId?: string;
};

export type PricingSnapshot = {
  inputPriceMicrousdPerMillion: number;
  outputPriceMicrousdPerMillion: number;
  cacheReadPriceMicrousdPerMillion: number;
  cacheWritePriceMicrousdPerMillion: number;
  imageInputPriceMicrousdPerMillion?: number;
  imageOutputPriceMicrousdPerMillion?: number;
  markupBps: number;
  discountBps: number;
};

export type ChargeBreakdown = {
  billableInputTokens: number;
  inputCostMicrousd: number;
  outputCostMicrousd: number;
  cacheReadCostMicrousd: number;
  cacheWriteCostMicrousd: number;
  providerCostMicrousd: number;
  chargedMicrousd: number;
};

export type EffectivePricingRule = PricingSnapshot & {
  id: string;
  modelId: string;
  userTier: string;
  status: string;
  effectiveFrom: Date;
  effectiveTo?: Date | null;
};
