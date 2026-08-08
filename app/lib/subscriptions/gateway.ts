import type { PoolClient } from "pg";

type Row = {
  subscription_id: string;
  plan_version_id: string;
  subscription_status: string;
  current_period_start: Date;
  current_period_end: Date;
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
  billing_period: string;
  overage_policy: "deny" | "cash_balance";
  entitlement_id: string | null;
  gateway_scopes: string[] | null;
  requests_per_minute: number | null;
  daily_token_limit: string | number | null;
  monthly_token_limit: string | number | null;
  allowance_id: string | null;
  granted_tokens: string | number | null;
  reserved_tokens: string | number | null;
  consumed_tokens: string | number | null;
  granted_microusd: string | number | null;
  reserved_microusd: string | number | null;
  consumed_microusd: string | number | null;
};

export type GatewaySubscriptionContext = {
  subscriptionId: string;
  planVersionId: string;
  entitlementId: string;
  allowanceId: string;
  coverageMode: "token_allowance" | "money_allowance" | "cash_only";
  allowanceReservedTokens: number;
  allowanceReservedMicrousd: number;
  cashReservedMicrousd: number;
  limits: {
    requestsPerMinute?: number;
    dailyTokenLimit?: number;
    monthlyTokenLimit?: number;
  };
  snapshot: Record<string, unknown>;
};

export type GatewaySubscriptionRejection = {
  code: string;
  status: 402 | 403 | 409;
  message: string;
  availableMicrousd?: number;
  requiredMicrousd?: number;
};

function safe(value: string | number | null, name: string) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`${name} is outside the safe integer range`);
  }
  return parsed;
}

function optional(value: string | number | null) {
  return value === null ? undefined : safe(value, "subscription limit");
}

export async function resolveGatewaySubscriptionOnClient(
  client: PoolClient,
  input: {
    platformUserId: string;
    modelId: string;
    requiredScope: string;
    estimatedTokens: number;
    reservationMicrousd: number;
    at: Date;
  },
): Promise<GatewaySubscriptionContext | GatewaySubscriptionRejection | null> {
  const result = await client.query<Row>(
    `SELECT s.id AS subscription_id, s.plan_version_id,
            s.status AS subscription_status, s.current_period_start,
            s.current_period_end, s.trial_ends_at, s.grace_ends_at,
            v.billing_period, v.overage_policy,
            e.id AS entitlement_id, e.gateway_scopes,
            e.requests_per_minute, e.daily_token_limit,
            e.monthly_token_limit, a.id AS allowance_id,
            a.granted_tokens, a.reserved_tokens, a.consumed_tokens,
            a.granted_microusd, a.reserved_microusd,
            a.consumed_microusd
     FROM subscriptions s
     JOIN subscription_plan_versions v ON v.id = s.plan_version_id
     LEFT JOIN subscription_plan_entitlements e
       ON e.plan_version_id = s.plan_version_id
      AND e.model_id = $2 AND e.enabled
     LEFT JOIN subscription_usage_allowances a
       ON a.subscription_id = s.id
      AND a.period_start = s.current_period_start
      AND a.period_end = s.current_period_end
     WHERE s.platform_user_id = $1
     ORDER BY s.created_at DESC
     LIMIT 1
     FOR SHARE OF s, v`,
    [input.platformUserId, input.modelId],
  );
  const row = result.rows[0];
  // Compatibility phase: users that have never been assigned a subscription
  // continue through the existing balance-only policy.
  if (!row) return null;

  const inGrace =
    row.subscription_status === "past_due" &&
    row.grace_ends_at !== null &&
    row.grace_ends_at > input.at;
  const callable =
    ["active", "cancel_at_period_end"].includes(row.subscription_status) ||
    (row.subscription_status === "trial" &&
      row.trial_ends_at !== null &&
      row.trial_ends_at > input.at) ||
    inGrace;
  if (!callable) {
    return {
      code:
        row.subscription_status === "paused"
          ? "SUBSCRIPTION_PAUSED"
          : "SUBSCRIPTION_INACTIVE",
      status: 403,
      message: "The user subscription is not callable",
    };
  }
  if (row.current_period_end <= input.at && !inGrace) {
    return {
      code: "SUBSCRIPTION_PERIOD_EXPIRED",
      status: 403,
      message: "The current subscription period has expired",
    };
  }
  if (!row.entitlement_id || !row.gateway_scopes) {
    return {
      code: "SUBSCRIPTION_MODEL_NOT_ALLOWED",
      status: 403,
      message: "The subscription does not allow this model",
    };
  }
  if (!row.gateway_scopes.includes(input.requiredScope)) {
    return {
      code: "SUBSCRIPTION_SCOPE_NOT_ALLOWED",
      status: 403,
      message: "The subscription entitlement does not allow this Gateway scope",
    };
  }
  if (!row.allowance_id) {
    return {
      code: "SUBSCRIPTION_ALLOWANCE_NOT_READY",
      status: 409,
      message: "The current subscription allowance has not been provisioned",
    };
  }

  const tokenRemaining =
    safe(row.granted_tokens, "granted_tokens") -
    safe(row.reserved_tokens, "reserved_tokens") -
    safe(row.consumed_tokens, "consumed_tokens");
  const moneyRemaining =
    safe(row.granted_microusd, "granted_microusd") -
    safe(row.reserved_microusd, "reserved_microusd") -
    safe(row.consumed_microusd, "consumed_microusd");
  const hasTokenAllowance = safe(row.granted_tokens, "granted_tokens") > 0;
  const hasMoneyAllowance =
    safe(row.granted_microusd, "granted_microusd") > 0;

  let coverageMode: GatewaySubscriptionContext["coverageMode"] = "cash_only";
  let allowanceReservedTokens = 0;
  let allowanceReservedMicrousd = 0;
  let cashReservedMicrousd = input.reservationMicrousd;
  if (hasTokenAllowance && tokenRemaining >= input.estimatedTokens) {
    coverageMode = "token_allowance";
    allowanceReservedTokens = input.estimatedTokens;
    cashReservedMicrousd = 0;
  } else if (hasMoneyAllowance && moneyRemaining > 0) {
    coverageMode = "money_allowance";
    allowanceReservedMicrousd = Math.min(
      moneyRemaining,
      input.reservationMicrousd,
    );
    cashReservedMicrousd =
      input.reservationMicrousd - allowanceReservedMicrousd;
  }

  if (cashReservedMicrousd > 0 && row.overage_policy === "deny") {
    return {
      code: "SUBSCRIPTION_ALLOWANCE_EXHAUSTED",
      status: 402,
      message: "The subscription allowance is insufficient and overage is disabled",
      availableMicrousd:
        coverageMode === "money_allowance" ? moneyRemaining : tokenRemaining,
      requiredMicrousd:
        coverageMode === "money_allowance"
          ? input.reservationMicrousd
          : input.estimatedTokens,
    };
  }

  return {
    subscriptionId: row.subscription_id,
    planVersionId: row.plan_version_id,
    entitlementId: row.entitlement_id,
    allowanceId: row.allowance_id,
    coverageMode,
    allowanceReservedTokens,
    allowanceReservedMicrousd,
    cashReservedMicrousd,
    limits: {
      requestsPerMinute: row.requests_per_minute ?? undefined,
      dailyTokenLimit: optional(row.daily_token_limit),
      monthlyTokenLimit: optional(row.monthly_token_limit),
    },
    snapshot: {
      status: row.subscription_status,
      billingPeriod: row.billing_period,
      periodStart: row.current_period_start.toISOString(),
      periodEnd: row.current_period_end.toISOString(),
      overagePolicy: row.overage_policy,
      gatewayScopes: row.gateway_scopes,
      coverageMode,
    },
  };
}

export async function reserveSubscriptionAllowanceOnClient(
  client: PoolClient,
  input: GatewaySubscriptionContext,
) {
  if (
    input.allowanceReservedTokens === 0 &&
    input.allowanceReservedMicrousd === 0
  ) return;
  const result = await client.query(
    `UPDATE subscription_usage_allowances
     SET reserved_tokens = reserved_tokens + $2,
         reserved_microusd = reserved_microusd + $3,
         version = version + 1, updated_at = NOW()
     WHERE id = $1
       AND reserved_tokens + consumed_tokens + $2 <= granted_tokens
       AND reserved_microusd + consumed_microusd + $3 <= granted_microusd`,
    [
      input.allowanceId,
      input.allowanceReservedTokens,
      input.allowanceReservedMicrousd,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error("SUBSCRIPTION_ALLOWANCE_CONCURRENT_CONFLICT");
  }
}

export async function releaseSubscriptionAllowanceOnClient(
  client: PoolClient,
  input: GatewaySubscriptionContext,
) {
  if (
    input.allowanceReservedTokens === 0 &&
    input.allowanceReservedMicrousd === 0
  ) return;
  const result = await client.query(
    `UPDATE subscription_usage_allowances
     SET reserved_tokens = reserved_tokens - $2,
         reserved_microusd = reserved_microusd - $3,
         version = version + 1, updated_at = NOW()
     WHERE id = $1 AND reserved_tokens >= $2 AND reserved_microusd >= $3`,
    [
      input.allowanceId,
      input.allowanceReservedTokens,
      input.allowanceReservedMicrousd,
    ],
  );
  if (result.rowCount !== 1) {
    throw new Error("SUBSCRIPTION_ALLOWANCE_RELEASE_INVARIANT");
  }
}

export async function settleSubscriptionAllowanceOnClient(
  client: PoolClient,
  input: {
    allowanceId: string | null;
    coverageMode: string | null;
    reservedTokens: number;
    reservedMicrousd: number;
    actualTokens: number;
    chargeMicrousd: number;
  },
) {
  if (!input.allowanceId || !input.coverageMode) {
    return {
      cashChargeMicrousd: input.chargeMicrousd,
      allowanceChargeMicrousd: 0,
      allowanceChargedTokens: 0,
    };
  }
  const result = await client.query<{
    granted_tokens: string | number;
    reserved_tokens: string | number;
    consumed_tokens: string | number;
    granted_microusd: string | number;
    reserved_microusd: string | number;
    consumed_microusd: string | number;
  }>(
    `SELECT granted_tokens, reserved_tokens, consumed_tokens,
            granted_microusd, reserved_microusd, consumed_microusd
     FROM subscription_usage_allowances WHERE id = $1 FOR UPDATE`,
    [input.allowanceId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("SUBSCRIPTION_ALLOWANCE_NOT_FOUND");
  const reservedTokens = safe(row.reserved_tokens, "reserved_tokens");
  const reservedMoney = safe(row.reserved_microusd, "reserved_microusd");
  if (
    reservedTokens < input.reservedTokens ||
    reservedMoney < input.reservedMicrousd
  ) {
    throw new Error("SUBSCRIPTION_ALLOWANCE_SETTLEMENT_INVARIANT");
  }

  let allowanceChargedTokens = 0;
  let allowanceChargeMicrousd = 0;
  let allowanceConsumedMicrousd = 0;
  if (input.coverageMode === "token_allowance") {
    const availableIncludingRequest =
      safe(row.granted_tokens, "granted_tokens") -
      safe(row.consumed_tokens, "consumed_tokens") -
      (reservedTokens - input.reservedTokens);
    allowanceChargedTokens = Math.min(
      input.actualTokens,
      Math.max(0, availableIncludingRequest),
    );
    allowanceChargeMicrousd =
      input.actualTokens === 0
        ? 0
        : Math.floor(
            (input.chargeMicrousd * allowanceChargedTokens) /
              input.actualTokens,
          );
  } else if (input.coverageMode === "money_allowance") {
    const availableIncludingRequest =
      safe(row.granted_microusd, "granted_microusd") -
      safe(row.consumed_microusd, "consumed_microusd") -
      (reservedMoney - input.reservedMicrousd);
    allowanceChargeMicrousd = Math.min(
      input.chargeMicrousd,
      Math.max(0, availableIncludingRequest),
    );
    allowanceConsumedMicrousd = allowanceChargeMicrousd;
  }

  await client.query(
    `UPDATE subscription_usage_allowances
     SET reserved_tokens = reserved_tokens - $2,
         consumed_tokens = consumed_tokens + $3,
         reserved_microusd = reserved_microusd - $4,
         consumed_microusd = consumed_microusd + $5,
         version = version + 1, updated_at = NOW()
     WHERE id = $1`,
    [
      input.allowanceId,
      input.reservedTokens,
      allowanceChargedTokens,
      input.reservedMicrousd,
      allowanceConsumedMicrousd,
    ],
  );
  return {
    cashChargeMicrousd: input.chargeMicrousd - allowanceChargeMicrousd,
    allowanceChargeMicrousd,
    allowanceChargedTokens,
  };
}
