export type AiProviderProtocol = "anthropic" | "openai";

export type InputTokenSemantics = "fresh" | "total_including_cache";

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  inputTokenSemantics: InputTokenSemantics;
  providerModel?: string;
  upstreamRequestId?: string;
};

export type PricingSnapshot = {
  inputPriceMicrousdPerMillion: number;
  outputPriceMicrousdPerMillion: number;
  cacheReadPriceMicrousdPerMillion: number;
  cacheWritePriceMicrousdPerMillion: number;
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
