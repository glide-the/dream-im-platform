export const productActions = [
  "create",
  "renew",
  "upgrade",
  "downgrade",
  "pause",
  "resume",
  "cancel",
  "revoke_cancel",
] as const;

export type ProductAction = (typeof productActions)[number];

export type ProductPrincipal = {
  canonicalUserId: string;
  platformUserId: string;
  clientId: string;
  tokenId: string;
  scopes: readonly string[];
  tier: string;
};

export type ProductEntitlementDto = {
  gatewayScopes: string[];
  modelAliases: string[];
  rpmLimit: number | null;
  dailyTokenLimit: number | null;
  storageBytes: number | null;
};

export type ProductPlanSummaryDto = {
  planCode: string;
  planName: string;
  planVersionId: string;
  version: number;
  billingCycle: "monthly";
  monthlyAllowanceTokens: number;
  monthlyPriceMicrousd: number;
  currency: "USD";
};

export type ProductPlanDto = ProductPlanSummaryDto & {
  description: string | null;
  entitlements: ProductEntitlementDto[];
  eligibility: {
    eligible: boolean;
    reasonCode: string | null;
    appliesAt: string | null;
  };
  availableActions: ProductAction[];
};

export type ProductAllowanceDto = {
  unit: "tokens";
  granted: number;
  reserved: number;
  consumed: number;
  remaining: number;
  resetsAt: string;
};

export type ProductPendingChangeDto = ProductPlanSummaryDto & {
  appliesAt: string;
};

export type ProductSubscriptionDto = {
  id: string;
  status: string;
  version: number;
  cycleAnchorAt: string;
  currentPeriodNumber: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  renewalEnabled: boolean;
  cancelAtPeriodEnd: boolean;
  pendingChange: ProductPendingChangeDto | null;
  allowedActions: ProductAction[];
};

export type ProductSubscriptionContextDto = {
  canonicalUser: { id: string };
  subscription: ProductSubscriptionDto | null;
  planVersion: ProductPlanSummaryDto | null;
  entitlements: Array<{
    gatewayScope: string;
    modelAliases: string[];
    rpmLimit: number | null;
    dailyTokenLimit: number | null;
    storageBytes: number | null;
  }>;
  allowance: ProductAllowanceDto | null;
  asOf: string;
};

export type ProductUsageItemDto = {
  gatewayRequestId: string;
  modelAlias: string;
  gatewayScope: string;
  protocol: "anthropic" | "openai";
  outcome: "completed" | "failed" | "cancelled" | "inProgress";
  settlementState: "settled" | "usageUnknown" | "inProgress" | "rejected";
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  allowanceReservedTokens: number;
  allowanceConsumedTokens: number;
  allowanceReleasedTokens: number;
  occurredAt: string;
  errorCategory: string | null;
};

export type ProductUsageDto = {
  period: {
    start: string;
    end: string;
    timezone: "UTC";
  } | null;
  allowance: ProductAllowanceDto | null;
  summary: {
    requestCount: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    totalTokens: number;
    unknownUsageCount: number;
  };
  projection: {
    asOf: string;
    sampleWindowDays: number;
    projectedExhaustionAt: string | null;
    projectedTokenShortfall: number | null;
    confidence: "insufficientData";
  };
  items: ProductUsageItemDto[];
};

export type ProductModelDto = {
  modelAlias: string;
  displayName: string;
  description: string | null;
  capabilities: string[];
  contexts: string[];
  eligibility: {
    allowed: true;
    reasonCode: null;
    subscriptionStatus: string;
    gatewayScopes: string[];
    rpmLimit: number | null;
    dailyTokenLimit: number | null;
    storageBytes: number | null;
    monthlyTokenRemaining: number;
    monthlyTokenResetAt: string;
  };
  limits: {
    contextWindow: number | null;
    maxOutputTokens: number | null;
  };
  availability: "available";
  asOf: string;
};

export type ProductModelCatalogDto = {
  items: ProductModelDto[];
  asOf: string;
};

export type ProductPreviewDto = {
  action: ProductAction;
  allowed: boolean;
  reasonCode: string | null;
  previewId: string;
  digest: string;
  expiresAt: string;
  expectedVersion: number | null;
  current: ProductPlanSummaryDto | null;
  target: ProductPlanSummaryDto | null;
  appliesAt: string | null;
  allowanceImpact: {
    unit: "tokens";
    currentPeriodTokens: number | null;
    nextPeriodTokens: number | null;
    currentPeriodChanges: boolean;
  };
  entitlementImpact: {
    currentModelAliases: string[];
    targetModelAliases: string[];
  };
  gatewayImpact: {
    callableAfterExecute: boolean;
  };
  warnings: string[];
};

export type ProductCommandResultDto = {
  commandId: string;
  outcome: "applied" | "scheduled";
  subscription: {
    id: string;
    status: string;
    version: number;
    planVersionId: string;
    pendingPlanVersionId: string | null;
    currentPeriodStart: string;
    currentPeriodEnd: string;
  };
  actualImpact: {
    unit: "tokens";
    appliesAt: string | null;
    grantedTokens: number | null;
    reservedTokens: number | null;
    consumedTokens: number | null;
    remainingTokens: number | null;
  };
  idempotentReplay: boolean;
};
