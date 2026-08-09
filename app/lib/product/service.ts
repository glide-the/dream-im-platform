import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type {
  ExecuteSubscriptionCommand,
  PlansQuery,
  PreviewSubscriptionCommand,
  UsageQuery,
} from "./contracts";
import {
  productCommandPort,
  type ProductCommandPort,
} from "./command-port";
import { ProductError } from "./errors";
import {
  findCurrentAllowanceOnClient,
  findProductSubscriptionOnClient,
  findProductTargetVersionOnClient,
  listProductModelsOnClient,
  listProductPlansOnClient,
  listProductUsageOnClient,
  listVersionEntitlementsOnClient,
  productTransactionTimeOnClient,
  type ProductAllowanceRow,
  type ProductEntitlementRow,
  type ProductSubscriptionRow,
  type ProductTargetVersionRow,
  type ProductUsageRow,
  type ProductUsageSummaryRow,
} from "./repository";
import {
  issueProductPreviewReceipt,
  verifyProductPreviewReceipt,
  type ProductPreviewReceipt,
} from "./receipts";
import type {
  ProductAction,
  ProductAllowanceDto,
  ProductCommandResultDto,
  ProductEntitlementDto,
  ProductModelCatalogDto,
  ProductPlanDto,
  ProductPlanSummaryDto,
  ProductPreviewDto,
  ProductPrincipal,
  ProductSubscriptionContextDto,
  ProductUsageDto,
  ProductUsageItemDto,
} from "./types";
import {
  withProductReadUnitOfWork,
  type ProductReadUnitOfWork,
} from "./uow";

const gatewayScopes = new Set([
  "messages:create",
  "chat:create",
  "models:list",
]);
const productIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

type ProductServiceDependencies = {
  readUnitOfWork?: ProductReadUnitOfWork;
  clock?: () => Date;
  commandPort?: ProductCommandPort;
  issueReceipt?: typeof issueProductPreviewReceipt;
  verifyReceipt?: typeof verifyProductPreviewReceipt;
  listPlans?: typeof listProductPlansOnClient;
  findSubscription?: typeof findProductSubscriptionOnClient;
  findAllowance?: typeof findCurrentAllowanceOnClient;
  listEntitlements?: typeof listVersionEntitlementsOnClient;
  listUsage?: typeof listProductUsageOnClient;
  listModels?: typeof listProductModelsOnClient;
  findTargetVersion?: typeof findProductTargetVersionOnClient;
  transactionTime?: typeof productTransactionTimeOnClient;
};

function safeInteger(
  value: string | number | null | undefined,
  field: string,
  nullable = false,
) {
  if (value === null || value === undefined) {
    if (nullable) return null;
    throw new ProductError(
      "PRODUCT_DATA_INVALID",
      "The Product API source data is invalid",
      503,
      { field },
    );
  }
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProductError(
      "PRODUCT_DATA_INVALID",
      "The Product API source data is invalid",
      503,
      { field },
    );
  }
  return parsed;
}

function safeText(value: unknown, field: string, maximum = 4_000) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    throw new ProductError(
      "PRODUCT_DATA_INVALID",
      "The Product API source data is invalid",
      503,
      { field },
    );
  }
  return value;
}

function safeOptionalText(value: unknown, field: string, maximum = 4_000) {
  if (value === null || value === undefined) return null;
  return safeText(value, field, maximum);
}

function safeIdentifier(value: unknown, field: string, maximum = 200) {
  const identifier = safeText(value, field, maximum);
  if (!productIdentifierPattern.test(identifier)) {
    throw new ProductError(
      "PRODUCT_DATA_INVALID",
      "The Product API source data contains an unsafe identifier",
      503,
      { field },
    );
  }
  return identifier;
}

function safeOptionalIdentifier(
  value: unknown,
  field: string,
  maximum = 200,
) {
  if (value === null || value === undefined) return null;
  return safeIdentifier(value, field, maximum);
}

function iso(value: unknown, field: string) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new ProductError(
      "PRODUCT_DATA_INVALID",
      "The Product API source data is invalid",
      503,
      { field },
    );
  }
  return date.toISOString();
}

function productStatus(value: string) {
  const allowed = new Set([
    "trial",
    "active",
    "past_due",
    "paused",
    "cancel_at_period_end",
    "cancelled",
    "expired",
  ]);
  if (!allowed.has(value)) {
    throw new ProductError(
      "PRODUCT_DATA_INVALID",
      "The Product API source data is invalid",
      503,
      { field: "subscription.status" },
    );
  }
  return value;
}

function allowanceDto(
  row: ProductAllowanceRow | null,
  resetsAt: Date,
): ProductAllowanceDto | null {
  if (!row) return null;
  const granted = safeInteger(row.granted_tokens, "allowance.granted");
  const reserved = safeInteger(row.reserved_tokens, "allowance.reserved");
  const consumed = safeInteger(row.consumed_tokens, "allowance.consumed");
  if (reserved + consumed > granted) {
    throw new ProductError(
      "PRODUCT_DATA_INVALID",
      "The Product API source data violates Token conservation",
      503,
    );
  }
  return {
    unit: "tokens",
    granted,
    reserved,
    consumed,
    remaining: granted - reserved - consumed,
    resetsAt: iso(resetsAt, "allowance.resetsAt"),
  };
}

function minimumNullable(left: number | null, right: number | null) {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}

function safeScopeList(scopes: string[]) {
  if (!Array.isArray(scopes) || scopes.some((scope) => !gatewayScopes.has(scope))) {
    throw new ProductError(
      "PRODUCT_DATA_INVALID",
      "The Product API source data contains an unsupported Gateway scope",
      503,
    );
  }
  return [...new Set(scopes)].sort();
}

function entitlementDto(row: ProductEntitlementRow): ProductEntitlementDto {
  return {
    gatewayScopes: safeScopeList(row.gateway_scopes),
    modelAliases: [safeIdentifier(row.model_alias, "modelAlias", 120)],
    rpmLimit: safeInteger(row.requests_per_minute, "rpmLimit", true),
    dailyTokenLimit: safeInteger(
      row.daily_token_limit,
      "dailyTokenLimit",
      true,
    ),
    storageBytes: safeInteger(row.storage_bytes_limit, "storageBytes", true),
  };
}

function groupedContextEntitlements(rows: ProductEntitlementRow[]) {
  const grouped = new Map<
    string,
    {
      aliases: Set<string>;
      rpmLimit: number | null;
      dailyTokenLimit: number | null;
      storageBytes: number | null;
    }
  >();
  for (const row of rows) {
    const dto = entitlementDto(row);
    for (const scope of dto.gatewayScopes) {
      const current = grouped.get(scope) ?? {
        aliases: new Set<string>(),
        rpmLimit: null,
        dailyTokenLimit: null,
        storageBytes: null,
      };
      dto.modelAliases.forEach((alias) => current.aliases.add(alias));
      current.rpmLimit = minimumNullable(current.rpmLimit, dto.rpmLimit);
      current.dailyTokenLimit = minimumNullable(
        current.dailyTokenLimit,
        dto.dailyTokenLimit,
      );
      current.storageBytes = minimumNullable(
        current.storageBytes,
        dto.storageBytes,
      );
      grouped.set(scope, current);
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([gatewayScope, value]) => ({
      gatewayScope,
      modelAliases: [...value.aliases].sort(),
      rpmLimit: value.rpmLimit,
      dailyTokenLimit: value.dailyTokenLimit,
      storageBytes: value.storageBytes,
    }));
}

function rowPlanSummary(
  row: ProductSubscriptionRow,
  pending = false,
): ProductPlanSummaryDto {
  if (pending) {
    if (
      !row.pending_plan_version_id ||
      !row.pending_plan_code ||
      !row.pending_plan_name ||
      row.pending_plan_version_number === null ||
      row.pending_allowance_tokens === null ||
      row.pending_base_price_microusd === null ||
      row.pending_currency === null
    ) {
      throw new ProductError(
        "PRODUCT_DATA_INVALID",
        "The Product API pending plan data is incomplete",
        503,
      );
    }
    return {
      planCode: safeIdentifier(row.pending_plan_code, "pending.planCode", 80),
      planName: safeText(row.pending_plan_name, "pending.planName", 160),
      planVersionId: safeIdentifier(
        row.pending_plan_version_id,
        "pending.planVersionId",
        100,
      ),
      version: safeInteger(
        row.pending_plan_version_number,
        "pending.version",
      ),
      billingCycle: "monthly",
      monthlyAllowanceTokens: safeInteger(
        row.pending_allowance_tokens,
        "pending.monthlyAllowanceTokens",
      ),
      monthlyPriceMicrousd: safeInteger(
        row.pending_base_price_microusd,
        "pending.monthlyPriceMicrousd",
      ),
      currency: row.pending_currency,
    };
  }
  return {
    planCode: safeIdentifier(row.current_plan_code, "planCode", 80),
    planName: safeText(row.current_plan_name, "planName", 160),
    planVersionId: safeIdentifier(
      row.current_plan_version_id,
      "planVersionId",
      100,
    ),
    version: safeInteger(row.current_plan_version_number, "planVersion"),
    billingCycle: "monthly",
    monthlyAllowanceTokens: safeInteger(
      row.current_allowance_tokens,
      "monthlyAllowanceTokens",
    ),
    monthlyPriceMicrousd: safeInteger(
      row.current_base_price_microusd,
      "monthlyPriceMicrousd",
    ),
    currency: row.current_currency,
  };
}

function targetPlanSummary(row: ProductTargetVersionRow): ProductPlanSummaryDto {
  return {
    planCode: safeIdentifier(row.plan_code, "target.planCode", 80),
    planName: safeText(row.plan_name, "target.planName", 160),
    planVersionId: safeIdentifier(
      row.plan_version_id,
      "target.planVersionId",
      100,
    ),
    version: safeInteger(row.version_number, "target.version"),
    billingCycle: "monthly",
    monthlyAllowanceTokens: safeInteger(
      row.allowance_tokens,
      "target.monthlyAllowanceTokens",
    ),
    monthlyPriceMicrousd: safeInteger(
      row.base_price_microusd,
      "target.monthlyPriceMicrousd",
    ),
    currency: row.currency,
  };
}

function allowedSubscriptionActions(
  row: ProductSubscriptionRow,
  now: Date,
): ProductAction[] {
  if (row.status === "active" || row.status === "trial") {
    return [
      ...(now >= row.current_period_end ? (["renew"] as ProductAction[]) : []),
      "upgrade",
      "downgrade",
      "pause",
      "cancel",
    ];
  }
  if (row.status === "paused" && now < row.current_period_end) return ["resume"];
  if (row.status === "past_due" && now >= row.current_period_end) return ["renew"];
  if (row.status === "cancel_at_period_end" && now < row.current_period_end) {
    return ["revoke_cancel"];
  }
  return [];
}

function assertTokenOnlySubscription(row: ProductSubscriptionRow) {
  if (
    !row.current_version_token_only ||
    (row.pending_plan_version_id && !row.pending_version_token_only)
  ) {
    throw new ProductError(
      "PRODUCT_DEPENDENCY_UNAVAILABLE",
      "The subscription cannot be safely projected by the Token-only Product API",
      503,
    );
  }
}

function dependencies(input: ProductServiceDependencies) {
  return {
    readUnitOfWork: input.readUnitOfWork ?? withProductReadUnitOfWork,
    clock: input.clock ?? (() => new Date()),
    commandPort: input.commandPort ?? productCommandPort,
    issueReceipt: input.issueReceipt ?? issueProductPreviewReceipt,
    verifyReceipt: input.verifyReceipt ?? verifyProductPreviewReceipt,
    listPlans: input.listPlans ?? listProductPlansOnClient,
    findSubscription: input.findSubscription ?? findProductSubscriptionOnClient,
    findAllowance: input.findAllowance ?? findCurrentAllowanceOnClient,
    listEntitlements: input.listEntitlements ?? listVersionEntitlementsOnClient,
    listUsage: input.listUsage ?? listProductUsageOnClient,
    listModels: input.listModels ?? listProductModelsOnClient,
    findTargetVersion:
      input.findTargetVersion ?? findProductTargetVersionOnClient,
    transactionTime: input.transactionTime ?? productTransactionTimeOnClient,
  };
}

export async function getProductPlans(
  principal: ProductPrincipal,
  query: PlansQuery,
  inputDependencies: ProductServiceDependencies = {},
) {
  const deps = dependencies(inputDependencies);
  return await deps.readUnitOfWork(async (client) => {
    const asOf = await deps.transactionTime(client);
    const [result, current] = await Promise.all([
      deps.listPlans(client, query),
      deps.findSubscription(client, principal.platformUserId, true),
    ]);
    if (current) assertTokenOnlySubscription(current);
    const byVersion = new Map<string, ProductEntitlementRow[]>();
    for (const row of result.entitlements) {
      byVersion.set(row.plan_version_id, [
        ...(byVersion.get(row.plan_version_id) ?? []),
        row,
      ]);
    }
    const data: ProductPlanDto[] = result.rows.map((row) => {
      const targetTokens = safeInteger(
        row.allowance_tokens,
        "monthlyAllowanceTokens",
      );
      let eligible = false;
      let reasonCode: string | null = "SUBSCRIPTION_STATE_CONFLICT";
      let appliesAt: string | null = null;
      let availableActions: ProductAction[] = [];
      if (!current) {
        eligible = true;
        reasonCode = null;
        appliesAt = asOf.toISOString();
        availableActions = ["create"];
      } else if (current.current_plan_version_id === row.plan_version_id) {
        reasonCode = "CURRENT_PLAN_VERSION";
      } else if (
        ["active", "trial"].includes(current.status) &&
        !current.pending_plan_version_id
      ) {
        eligible = true;
        reasonCode = null;
        appliesAt = current.current_period_end.toISOString();
        availableActions = [
          targetTokens >=
          safeInteger(current.current_allowance_tokens, "currentAllowanceTokens")
            ? "upgrade"
            : "downgrade",
        ];
      } else if (current.pending_plan_version_id) {
        reasonCode = "PENDING_CHANGE_EXISTS";
      }
      return {
        planCode: safeIdentifier(row.plan_code, "planCode", 80),
        planName: safeText(row.plan_name, "planName", 160),
        description: safeOptionalText(row.description, "description"),
        planVersionId: safeIdentifier(
          row.plan_version_id,
          "planVersionId",
          100,
        ),
        version: safeInteger(row.version_number, "version"),
        billingCycle: "monthly",
        monthlyAllowanceTokens: targetTokens,
        monthlyPriceMicrousd: safeInteger(
          row.base_price_microusd,
          "monthlyPriceMicrousd",
        ),
        currency: row.currency,
        entitlements: (byVersion.get(row.plan_version_id) ?? []).map(
          entitlementDto,
        ),
        eligibility: { eligible, reasonCode, appliesAt },
        availableActions,
      };
    });
    return {
      data,
      meta: {
        total: safeInteger(result.total, "total"),
        page: query.page,
        pageSize: query.pageSize,
      },
    };
  });
}

export async function getProductSubscriptionContext(
  principal: ProductPrincipal,
  inputDependencies: ProductServiceDependencies = {},
): Promise<ProductSubscriptionContextDto> {
  const deps = dependencies(inputDependencies);
  return await deps.readUnitOfWork(async (client) => {
    const asOf = await deps.transactionTime(client);
    const subscription = await deps.findSubscription(
      client,
      principal.platformUserId,
      false,
    );
    if (!subscription) {
      return {
        canonicalUser: {
          id: safeIdentifier(principal.canonicalUserId, "canonicalUser.id"),
        },
        subscription: null,
        planVersion: null,
        entitlements: [],
        allowance: null,
        asOf: asOf.toISOString(),
      };
    }
    assertTokenOnlySubscription(subscription);
    const [allowance, entitlementRows] = await Promise.all([
      deps.findAllowance(client, subscription),
      deps.listEntitlements(client, [subscription.current_plan_version_id]),
    ]);
    if (
      ["trial", "active", "paused", "cancel_at_period_end", "past_due"].includes(
        subscription.status,
      ) &&
      !allowance
    ) {
      throw new ProductError(
        "PRODUCT_DEPENDENCY_UNAVAILABLE",
        "The current subscription Token allowance is unavailable",
        503,
      );
    }
    const pending = subscription.pending_plan_version_id
      ? {
          ...rowPlanSummary(subscription, true),
          appliesAt: subscription.current_period_end.toISOString(),
        }
      : null;
    return {
      canonicalUser: {
        id: safeIdentifier(principal.canonicalUserId, "canonicalUser.id"),
      },
      subscription: {
        id: safeIdentifier(
          subscription.subscription_id,
          "subscription.id",
          100,
        ),
        status: productStatus(subscription.status),
        version: safeInteger(
          subscription.subscription_version,
          "subscription.version",
        ),
        cycleAnchorAt: iso(
          subscription.cycle_anchor_at,
          "subscription.cycleAnchorAt",
        ),
        currentPeriodNumber: safeInteger(
          subscription.current_period_number,
          "subscription.currentPeriodNumber",
        ),
        currentPeriodStart: iso(
          subscription.current_period_start,
          "subscription.currentPeriodStart",
        ),
        currentPeriodEnd: iso(
          subscription.current_period_end,
          "subscription.currentPeriodEnd",
        ),
        renewalEnabled: subscription.renewal_enabled,
        cancelAtPeriodEnd: subscription.status === "cancel_at_period_end",
        pendingChange: pending,
        allowedActions: allowedSubscriptionActions(subscription, asOf),
      },
      planVersion: rowPlanSummary(subscription),
      entitlements: groupedContextEntitlements(entitlementRows),
      allowance: allowanceDto(allowance, subscription.current_period_end),
      asOf: asOf.toISOString(),
    };
  });
}

function emptyUsage(asOf: Date): ProductUsageDto {
  return {
    period: null,
    allowance: null,
    summary: {
      requestCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 0,
      unknownUsageCount: 0,
    },
    projection: {
      asOf: asOf.toISOString(),
      sampleWindowDays: 7,
      projectedExhaustionAt: null,
      projectedTokenShortfall: null,
      confidence: "insufficientData",
    },
    items: [],
  };
}

function usageOutcome(value: string): ProductUsageItemDto["outcome"] {
  if (value === "succeeded") return "completed";
  if (value === "failed") return "failed";
  if (value === "cancelled") return "cancelled";
  if (value === "pending") return "inProgress";
  throw new ProductError(
    "PRODUCT_DATA_INVALID",
    "The Product API source data contains an unsupported request outcome",
    503,
  );
}

function settlementState(
  value: string,
): ProductUsageItemDto["settlementState"] {
  if (value === "settled") return "settled";
  if (value === "settlement_failed") return "usageUnknown";
  if (["received", "reserved", "streaming"].includes(value)) {
    return "inProgress";
  }
  if (value === "rejected") return "rejected";
  throw new ProductError(
    "PRODUCT_DATA_INVALID",
    "The Product API source data contains an unsupported settlement state",
    503,
  );
}

function errorCategory(row: ProductUsageRow) {
  if (!row.error_code) return null;
  if (row.status === "settlement_failed") return "usageUnknown";
  if (row.outcome === "cancelled") return "cancelled";
  if (row.http_status === 402) return "tokenAllowanceExhausted";
  if (row.http_status === 403) return "entitlementDenied";
  if (row.http_status === 409) return "conflict";
  if (row.http_status === 429) return "rateLimited";
  if (row.http_status && row.http_status >= 500) return "upstreamFailure";
  return "requestFailed";
}

function usageItem(row: ProductUsageRow): ProductUsageItemDto {
  const reserved = safeInteger(
    row.allowance_reserved_tokens,
    "usage.allowanceReservedTokens",
  );
  const consumed = safeInteger(
    row.allowance_charged_tokens,
    "usage.allowanceConsumedTokens",
  );
  return {
    gatewayRequestId: safeIdentifier(
      row.gateway_request_id,
      "usage.gatewayRequestId",
      100,
    ),
    modelAlias: safeIdentifier(row.model_alias, "usage.modelAlias", 120),
    gatewayScope:
      row.protocol === "anthropic" ? "messages:create" : "chat:create",
    protocol: row.protocol,
    outcome: usageOutcome(row.outcome),
    settlementState: settlementState(row.status),
    inputTokens: safeInteger(row.input_tokens, "usage.inputTokens"),
    outputTokens: safeInteger(row.output_tokens, "usage.outputTokens"),
    cacheReadTokens: safeInteger(
      row.cache_read_tokens,
      "usage.cacheReadTokens",
    ),
    cacheWriteTokens: safeInteger(
      row.cache_write_tokens,
      "usage.cacheWriteTokens",
    ),
    totalTokens: safeInteger(row.total_tokens, "usage.totalTokens"),
    allowanceReservedTokens: reserved,
    allowanceConsumedTokens: consumed,
    allowanceReleasedTokens:
      row.status === "settled" ? Math.max(0, reserved - consumed) : 0,
    occurredAt: iso(row.occurred_at, "usage.occurredAt"),
    errorCategory: errorCategory(row),
  };
}

function usageSummary(row: ProductUsageSummaryRow | undefined) {
  if (!row) {
    throw new ProductError(
      "PRODUCT_DEPENDENCY_UNAVAILABLE",
      "The Product API usage summary is unavailable",
      503,
    );
  }
  return {
    requestCount: safeInteger(row.request_count, "usage.requestCount"),
    inputTokens: safeInteger(row.input_tokens, "usage.inputTokens"),
    outputTokens: safeInteger(row.output_tokens, "usage.outputTokens"),
    cacheReadTokens: safeInteger(
      row.cache_read_tokens,
      "usage.cacheReadTokens",
    ),
    cacheWriteTokens: safeInteger(
      row.cache_write_tokens,
      "usage.cacheWriteTokens",
    ),
    totalTokens: safeInteger(row.total_tokens, "usage.totalTokens"),
    unknownUsageCount: safeInteger(
      row.unknown_usage_count,
      "usage.unknownUsageCount",
    ),
  };
}

export async function getProductUsage(
  principal: ProductPrincipal,
  query: UsageQuery,
  inputDependencies: ProductServiceDependencies = {},
) {
  const deps = dependencies(inputDependencies);
  return await deps.readUnitOfWork(async (client) => {
    const asOf = await deps.transactionTime(client);
    const subscription = await deps.findSubscription(
      client,
      principal.platformUserId,
      false,
    );
    if (!subscription) {
      return {
        data: emptyUsage(asOf),
        meta: { total: 0, page: query.page, pageSize: query.pageSize },
      };
    }
    assertTokenOnlySubscription(subscription);
    const [allowance, usage] = await Promise.all([
      deps.findAllowance(client, subscription),
      deps.listUsage(client, subscription, query),
    ]);
    if (!allowance) {
      throw new ProductError(
        "PRODUCT_DEPENDENCY_UNAVAILABLE",
        "The current subscription Token allowance is unavailable",
        503,
      );
    }
    const data: ProductUsageDto = {
      period: {
        start: iso(subscription.current_period_start, "usage.period.start"),
        end: iso(subscription.current_period_end, "usage.period.end"),
        timezone: "UTC",
      },
      allowance: allowanceDto(allowance, subscription.current_period_end),
      summary: usageSummary(usage.summary),
      projection: {
        asOf: asOf.toISOString(),
        sampleWindowDays: 7,
        projectedExhaustionAt: null,
        projectedTokenShortfall: null,
        confidence: "insufficientData",
      },
      items: usage.rows.map(usageItem),
    };
    return {
      data,
      meta: {
        total: safeInteger(usage.total, "usage.total"),
        page: query.page,
        pageSize: query.pageSize,
      },
    };
  });
}

function safeCapabilityList(value: Record<string, boolean> | null) {
  return Object.entries(value ?? {})
    .filter(
      ([key, enabled]) =>
        enabled &&
        /^[a-z][a-z0-9._:-]{0,79}$/.test(key) &&
        !/(provider|credential|secret|price|payment)/i.test(key),
    )
    .map(([key]) => key)
    .sort();
}

export async function getProductModelCatalog(
  principal: ProductPrincipal,
  inputDependencies: ProductServiceDependencies = {},
): Promise<ProductModelCatalogDto> {
  const deps = dependencies(inputDependencies);
  return await deps.readUnitOfWork(async (client) => {
    const asOf = await deps.transactionTime(client);
    const rows = await deps.listModels(client, principal);
    return {
      items: rows.map((row) => {
        const granted = safeInteger(row.granted_tokens, "model.grantedTokens");
        const reserved = safeInteger(
          row.reserved_tokens,
          "model.reservedTokens",
        );
        const consumed = safeInteger(
          row.consumed_tokens,
          "model.consumedTokens",
        );
        if (reserved + consumed > granted) {
          throw new ProductError(
            "PRODUCT_DATA_INVALID",
            "The Product API source data violates Token conservation",
            503,
          );
        }
        const entitlementRpm = safeInteger(
          row.entitlement_rpm,
          "model.entitlementRpm",
          true,
        );
        const userRpm = safeInteger(row.user_rpm, "model.userRpm", true);
        const entitlementDaily = safeInteger(
          row.entitlement_daily_tokens,
          "model.entitlementDailyTokens",
          true,
        );
        const userDaily = safeInteger(
          row.user_daily_tokens,
          "model.userDailyTokens",
          true,
        );
        return {
          modelAlias: safeIdentifier(row.model_alias, "modelAlias", 120),
          displayName: safeText(row.display_name, "displayName", 160),
          description: null,
          capabilities: safeCapabilityList(row.capabilities),
          contexts: [],
          eligibility: {
            allowed: true as const,
            reasonCode: null,
            subscriptionStatus: productStatus(row.subscription_status),
            gatewayScopes: safeScopeList(row.gateway_scopes),
            rpmLimit: minimumNullable(entitlementRpm, userRpm),
            dailyTokenLimit: minimumNullable(entitlementDaily, userDaily),
            storageBytes: safeInteger(
              row.entitlement_storage_bytes,
              "model.storageBytes",
              true,
            ),
            monthlyTokenRemaining: granted - reserved - consumed,
            monthlyTokenResetAt: iso(
              row.current_period_end,
              "model.monthlyTokenResetAt",
            ),
          },
          limits: {
            contextWindow: safeInteger(
              row.context_window,
              "model.contextWindow",
              true,
            ),
            maxOutputTokens: safeInteger(
              row.max_output_tokens,
              "model.maxOutputTokens",
              true,
            ),
          },
          availability: "available" as const,
          asOf: asOf.toISOString(),
        };
      }),
      asOf: asOf.toISOString(),
    };
  });
}

type EvaluatedCommand = {
  current: ProductPlanSummaryDto | null;
  target: ProductPlanSummaryDto | null;
  currentAliases: string[];
  targetAliases: string[];
  allowed: boolean;
  reasonCode: string | null;
  appliesAt: string | null;
  callableAfterExecute: boolean;
  currentPeriodChanges: boolean;
  warnings: string[];
};

async function evaluateCommand(
  client: PoolClient,
  principal: ProductPrincipal,
  command: PreviewSubscriptionCommand | ExecuteSubscriptionCommand,
  now: Date,
  deps: ReturnType<typeof dependencies>,
): Promise<EvaluatedCommand> {
  const currentRow = await deps.findSubscription(
    client,
    principal.platformUserId,
    true,
  );
  if (currentRow) assertTokenOnlySubscription(currentRow);
  if (command.action !== "create") {
    if (!currentRow) {
      throw new ProductError(
        "SUBSCRIPTION_NOT_FOUND",
        "The authenticated user has no current subscription",
        404,
      );
    }
    if (currentRow.subscription_version !== command.expectedVersion) {
      throw new ProductError(
        "VERSION_CONFLICT",
        "The subscription changed after the preview input was prepared",
        409,
        {
          expectedVersion: command.expectedVersion,
          actualVersion: currentRow.subscription_version,
        },
      );
    }
  }

  const explicitTarget = command.targetPlanVersionId
    ? await deps.findTargetVersion(client, command.targetPlanVersionId)
    : null;
  if (command.targetPlanVersionId && !explicitTarget) {
    throw new ProductError(
      "PLAN_NOT_FOUND",
      "The requested Token-only plan version is not available",
      404,
    );
  }
  const current = currentRow ? rowPlanSummary(currentRow) : null;
  const target = explicitTarget
    ? targetPlanSummary(explicitTarget)
    : command.action === "renew" && currentRow?.pending_plan_version_id
      ? rowPlanSummary(currentRow, true)
      : current;
  const versionIds = [
    ...(current ? [current.planVersionId] : []),
    ...(target && target.planVersionId !== current?.planVersionId
      ? [target.planVersionId]
      : []),
  ];
  const entitlementRows = await deps.listEntitlements(client, versionIds);
  const aliases = (versionId: string | undefined) => {
    const selected: string[] = entitlementRows
      .filter((row) => row.plan_version_id === versionId)
      .map((row) => safeIdentifier(row.model_alias, "modelAlias", 120));
    return [...new Set<string>(selected)].sort();
  };

  let allowed = true;
  let reasonCode: string | null = null;
  let appliesAt: string | null = null;
  let callableAfterExecute = true;
  let currentPeriodChanges = false;
  const warnings: string[] = [];
  const disallow = (reason: string) => {
    allowed = false;
    reasonCode = reason;
  };

  if (command.action === "create") {
    if (currentRow) disallow("SUBSCRIPTION_ALREADY_EXISTS");
    appliesAt = now.toISOString();
    currentPeriodChanges = true;
  } else if (!currentRow) {
    disallow("SUBSCRIPTION_NOT_FOUND");
  } else if (command.action === "renew") {
    appliesAt = currentRow.current_period_end.toISOString();
    currentPeriodChanges = true;
    if (!["trial", "active", "past_due"].includes(currentRow.status)) {
      disallow("SUBSCRIPTION_STATE_CONFLICT");
    } else if (now < currentRow.current_period_end) {
      disallow("SUBSCRIPTION_PERIOD_NOT_DUE");
    }
  } else if (command.action === "upgrade" || command.action === "downgrade") {
    appliesAt = currentRow.current_period_end.toISOString();
    if (!["trial", "active"].includes(currentRow.status)) {
      disallow("SUBSCRIPTION_STATE_CONFLICT");
    } else if (currentRow.pending_plan_version_id) {
      disallow("PENDING_CHANGE_EXISTS");
    } else if (target?.planVersionId === current.planVersionId) {
      disallow("CURRENT_PLAN_VERSION");
    } else if (
      command.action === "upgrade" &&
      target &&
      target.monthlyAllowanceTokens < current.monthlyAllowanceTokens
    ) {
      disallow("TARGET_NOT_UPGRADE");
    } else if (
      command.action === "downgrade" &&
      target &&
      target.monthlyAllowanceTokens > current.monthlyAllowanceTokens
    ) {
      disallow("TARGET_NOT_DOWNGRADE");
    }
    warnings.push("The plan change is scheduled for the current period boundary.");
  } else if (command.action === "pause") {
    appliesAt = now.toISOString();
    callableAfterExecute = false;
    if (!["trial", "active"].includes(currentRow.status)) {
      disallow("SUBSCRIPTION_STATE_CONFLICT");
    }
  } else if (command.action === "resume") {
    appliesAt = now.toISOString();
    if (
      currentRow.status !== "paused" ||
      now >= currentRow.current_period_end
    ) {
      disallow("SUBSCRIPTION_STATE_CONFLICT");
    }
  } else if (command.action === "cancel") {
    appliesAt = currentRow.current_period_end.toISOString();
    if (!["trial", "active"].includes(currentRow.status)) {
      disallow("SUBSCRIPTION_STATE_CONFLICT");
    }
    warnings.push("Access continues until the current period boundary.");
  } else if (command.action === "revoke_cancel") {
    appliesAt = now.toISOString();
    if (
      currentRow.status !== "cancel_at_period_end" ||
      now >= currentRow.current_period_end
    ) {
      disallow("SUBSCRIPTION_STATE_CONFLICT");
    }
  }

  return {
    current,
    target,
    currentAliases: aliases(current?.planVersionId),
    targetAliases: aliases(target?.planVersionId),
    allowed,
    reasonCode,
    appliesAt,
    callableAfterExecute,
    currentPeriodChanges,
    warnings,
  };
}

export async function previewProductSubscriptionCommand(
  principal: ProductPrincipal,
  command: PreviewSubscriptionCommand,
  inputDependencies: ProductServiceDependencies = {},
): Promise<ProductPreviewDto> {
  const deps = dependencies(inputDependencies);
  const now = deps.clock();
  const evaluation = await deps.readUnitOfWork(
    async (client) => await evaluateCommand(client, principal, command, now, deps),
  );
  const expectedVersion = command.expectedVersion ?? null;
  const receipt = deps.issueReceipt(
    {
      canonicalUserId: principal.canonicalUserId,
      clientId: principal.clientId,
      action: command.action,
      targetPlanVersionId: command.targetPlanVersionId,
      expectedVersion,
    },
    now,
  );
  return {
    action: command.action,
    allowed: evaluation.allowed,
    reasonCode: evaluation.reasonCode,
    ...receipt,
    expectedVersion,
    current: evaluation.current,
    target: evaluation.target,
    appliesAt: evaluation.appliesAt,
    allowanceImpact: {
      unit: "tokens",
      currentPeriodTokens:
        evaluation.current?.monthlyAllowanceTokens ?? null,
      nextPeriodTokens: evaluation.target?.monthlyAllowanceTokens ?? null,
      currentPeriodChanges: evaluation.currentPeriodChanges,
    },
    entitlementImpact: {
      currentModelAliases: evaluation.currentAliases,
      targetModelAliases: evaluation.targetAliases,
    },
    gatewayImpact: {
      callableAfterExecute: evaluation.callableAfterExecute,
    },
    warnings: evaluation.warnings,
  };
}

function snapshotValue(
  snapshot: Readonly<Record<string, unknown>>,
  key: string,
) {
  return snapshot[key];
}

function commandResult(
  principal: ProductPrincipal,
  command: ExecuteSubscriptionCommand,
  idempotencyKey: string,
  result: Awaited<ReturnType<ProductCommandPort["execute"]>>,
): ProductCommandResultDto {
  const snapshot = result.originalSnapshot;
  const subscriptionId = safeIdentifier(
    snapshotValue(snapshot, "id") ?? result.subscriptionId,
    "command.subscription.id",
    100,
  );
  if (subscriptionId !== result.subscriptionId) {
    throw new ProductError(
      "PRODUCT_COMMAND_RECEIPT_INVALID",
      "The subscription command receipt is invalid",
      503,
    );
  }
  const granted = safeInteger(
    snapshotValue(snapshot, "granted_tokens") as string | number | null,
    "command.grantedTokens",
    true,
  );
  const reserved = safeInteger(
    snapshotValue(snapshot, "reserved_tokens") as string | number | null,
    "command.reservedTokens",
    true,
  );
  const consumed = safeInteger(
    snapshotValue(snapshot, "consumed_tokens") as string | number | null,
    "command.consumedTokens",
    true,
  );
  if (
    granted !== null &&
    reserved !== null &&
    consumed !== null &&
    reserved + consumed > granted
  ) {
    throw new ProductError(
      "PRODUCT_COMMAND_RECEIPT_INVALID",
      "The subscription command receipt violates Token conservation",
      503,
    );
  }
  const scheduled = ["upgrade", "downgrade", "cancel"].includes(
    command.action,
  );
  const periodStart = iso(
    snapshotValue(snapshot, "current_period_start"),
    "command.subscription.currentPeriodStart",
  );
  const periodEnd = iso(
    snapshotValue(snapshot, "current_period_end"),
    "command.subscription.currentPeriodEnd",
  );
  const appliesAt = scheduled
    ? periodEnd
    : ["create", "renew"].includes(command.action)
      ? periodStart
      : null;
  return {
    commandId: `command_${createHash("sha256")
      .update(`${principal.canonicalUserId}:${idempotencyKey}`)
      .digest("base64url")}`,
    outcome: scheduled ? "scheduled" : "applied",
    subscription: {
      id: subscriptionId,
      status: productStatus(
        safeText(
          snapshotValue(snapshot, "status"),
          "command.subscription.status",
          40,
        ),
      ),
      version: safeInteger(
        snapshotValue(snapshot, "version") as string | number | null,
        "command.subscription.version",
      ),
      planVersionId: safeIdentifier(
        snapshotValue(snapshot, "plan_version_id"),
        "command.subscription.planVersionId",
        100,
      ),
      pendingPlanVersionId: safeOptionalIdentifier(
        snapshotValue(snapshot, "pending_plan_version_id"),
        "command.subscription.pendingPlanVersionId",
        100,
      ),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    },
    actualImpact: {
      unit: "tokens",
      appliesAt,
      grantedTokens: granted,
      reservedTokens: reserved,
      consumedTokens: consumed,
      remainingTokens:
        granted === null || reserved === null || consumed === null
          ? null
          : granted - reserved - consumed,
    },
    idempotentReplay: result.idempotentReplay,
  };
}

export async function executeProductSubscriptionCommand(
  principal: ProductPrincipal,
  command: ExecuteSubscriptionCommand,
  idempotencyKey: string,
  requestId: string,
  inputDependencies: ProductServiceDependencies = {},
): Promise<ProductCommandResultDto> {
  const deps = dependencies(inputDependencies);
  const now = deps.clock();
  const expectedVersion = command.expectedVersion ?? null;
  const receipt: ProductPreviewReceipt = {
    previewId: command.previewId,
    digest: command.digest,
    expiresAt: command.expiresAt,
  };
  deps.verifyReceipt(
    {
      canonicalUserId: principal.canonicalUserId,
      clientId: principal.clientId,
      action: command.action,
      targetPlanVersionId: command.targetPlanVersionId,
      expectedVersion,
    },
    receipt,
    now,
  );
  const evaluation = await deps.readUnitOfWork(
    async (client) => await evaluateCommand(client, principal, command, now, deps),
  );
  if (!evaluation.allowed) {
    throw new ProductError(
      "SUBSCRIPTION_STATE_CONFLICT",
      "The subscription command is not allowed in the current state",
      409,
      { reasonCode: evaluation.reasonCode },
    );
  }
  const result = await deps.commandPort.execute({
    requestId,
    canonicalUserId: principal.canonicalUserId,
    platformUserId: principal.platformUserId,
    clientId: principal.clientId,
    tokenId: principal.tokenId,
    action: command.action,
    targetPlanVersionId: command.targetPlanVersionId,
    expectedVersion,
    idempotencyKey,
    reason: command.reason,
    receipt,
  });
  return commandResult(principal, command, idempotencyKey, result);
}

export type { ProductServiceDependencies };
