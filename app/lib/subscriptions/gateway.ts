import type { PoolClient } from "pg";

import {
  appendSubscriptionTokenLedgerEntryOnClient,
  tokenLedgerSnapshot,
  type TokenAllowanceState,
} from "./token-ledger";

type Row = {
  subscription_id: string;
  plan_version_id: string;
  subscription_status: string;
  current_period_start: Date;
  current_period_end: Date;
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
  entitlement_id: string | null;
  gateway_scopes: string[] | null;
  requests_per_minute: number | null;
  daily_token_limit: string | number | null;
  monthly_token_limit: string | number | null;
  allowance_id: string | null;
  granted_tokens: string | number | null;
  bonus_granted_tokens: string | number | null;
  reserved_tokens: string | number | null;
  consumed_tokens: string | number | null;
};

export type GatewaySubscriptionContext = {
  platformUserId: string;
  subscriptionId: string;
  planVersionId: string;
  entitlementId: string;
  allowanceId: string;
  coverageMode: "token_allowance";
  allowanceReservedTokens: number;
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
  metric?: "tokens";
  unit?: "tokens";
  availableTokens?: number;
  requiredTokens?: number;
  periodEnd?: string;
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
    at: Date;
  },
): Promise<GatewaySubscriptionContext | GatewaySubscriptionRejection> {
  const result = await client.query<Row>(
    `SELECT s.id AS subscription_id, s.plan_version_id,
            s.status AS subscription_status, s.current_period_start,
            s.current_period_end, s.trial_ends_at, s.grace_ends_at,
            e.id AS entitlement_id, e.gateway_scopes,
            e.requests_per_minute, e.daily_token_limit,
            e.monthly_token_limit, a.id AS allowance_id,
            a.granted_tokens, a.bonus_granted_tokens,
            a.reserved_tokens, a.consumed_tokens
     FROM subscriptions s
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
     FOR SHARE OF s`,
    [input.platformUserId, input.modelId],
  );
  const row = result.rows[0];
  if (!row) {
    return {
      code: "SUBSCRIPTION_REQUIRED",
      status: 403,
      message: "An active Token subscription is required for Gateway access",
    };
  }

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
  if (row.current_period_start > input.at) {
    return {
      code: "SUBSCRIPTION_PERIOD_NOT_STARTED",
      status: 403,
      message: "The current subscription period has not started",
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
    safe(row.granted_tokens, "granted_tokens") +
    safe(row.bonus_granted_tokens, "bonus_granted_tokens") -
    safe(row.reserved_tokens, "reserved_tokens") -
    safe(row.consumed_tokens, "consumed_tokens");
  if (tokenRemaining < input.estimatedTokens) {
    return {
      code: "SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED",
      status: 402,
      message: "The current subscription-period Token allowance is insufficient",
      metric: "tokens",
      unit: "tokens",
      availableTokens: tokenRemaining,
      requiredTokens: input.estimatedTokens,
      periodEnd: row.current_period_end.toISOString(),
    };
  }

  return {
    platformUserId: input.platformUserId,
    subscriptionId: row.subscription_id,
    planVersionId: row.plan_version_id,
    entitlementId: row.entitlement_id,
    allowanceId: row.allowance_id,
    coverageMode: "token_allowance",
    allowanceReservedTokens: input.estimatedTokens,
    limits: {
      requestsPerMinute: row.requests_per_minute ?? undefined,
      dailyTokenLimit: optional(row.daily_token_limit),
      monthlyTokenLimit: optional(row.monthly_token_limit),
    },
    snapshot: {
      status: row.subscription_status,
      billingPeriod: "monthly",
      periodStart: row.current_period_start.toISOString(),
      periodEnd: row.current_period_end.toISOString(),
      gatewayScopes: row.gateway_scopes,
      coverageMode: "token_allowance",
    },
  };
}

export async function reserveSubscriptionAllowanceOnClient(
  client: PoolClient,
  input: GatewaySubscriptionContext,
  gatewayRequestId: string,
) {
  if (input.allowanceReservedTokens === 0) return;
  const locked = await client.query<{
    subscription_id: string;
    plan_version_id: string | null;
    granted_tokens: string | number;
    reserved_tokens: string | number;
    consumed_tokens: string | number;
  }>(
    `SELECT subscription_id, plan_version_id,
            granted_tokens + bonus_granted_tokens AS granted_tokens,
            reserved_tokens, consumed_tokens
     FROM subscription_usage_allowances
     WHERE id = $1
     FOR UPDATE`,
    [input.allowanceId],
  );
  const row = locked.rows[0];
  if (
    !row ||
    row.subscription_id !== input.subscriptionId ||
    row.plan_version_id !== input.planVersionId
  ) {
    throw new Error("SUBSCRIPTION_ALLOWANCE_PROVENANCE_MISMATCH");
  }
  const beforeState: TokenAllowanceState = {
    grantedTokens: safe(row.granted_tokens, "granted_tokens"),
    reservedTokens: safe(row.reserved_tokens, "reserved_tokens"),
    consumedTokens: safe(row.consumed_tokens, "consumed_tokens"),
  };
  const afterState: TokenAllowanceState = {
    ...beforeState,
    reservedTokens:
      beforeState.reservedTokens + input.allowanceReservedTokens,
  };
  tokenLedgerSnapshot(afterState);
  const result = await client.query(
    `UPDATE subscription_usage_allowances
     SET reserved_tokens = reserved_tokens + $2,
         version = version + 1, updated_at = NOW()
     WHERE id = $1
       AND reserved_tokens + consumed_tokens + $2 <= granted_tokens + bonus_granted_tokens`,
    [input.allowanceId, input.allowanceReservedTokens],
  );
  if (result.rowCount !== 1) {
    throw new Error("SUBSCRIPTION_ALLOWANCE_CONCURRENT_CONFLICT");
  }
  await appendSubscriptionTokenLedgerEntryOnClient(client, {
    platformUserId: input.platformUserId,
    subscriptionId: input.subscriptionId,
    planVersionId: input.planVersionId,
    allowanceId: input.allowanceId,
    gatewayRequestId,
    requestSequence: 1,
    entryType: "reserve",
    amountTokens: input.allowanceReservedTokens,
    before: tokenLedgerSnapshot(beforeState),
    after: tokenLedgerSnapshot(afterState),
    idempotencyKey: `${gatewayRequestId}:token:reserve`,
    metadata: { coverageMode: input.coverageMode },
  });
}

export async function releaseSubscriptionAllowanceOnClient(
  client: PoolClient,
  input: GatewaySubscriptionContext,
  gatewayRequestId: string,
) {
  if (input.allowanceReservedTokens === 0) return;
  const locked = await client.query<{
    subscription_id: string;
    plan_version_id: string | null;
    granted_tokens: string | number;
    reserved_tokens: string | number;
    consumed_tokens: string | number;
  }>(
    `SELECT subscription_id, plan_version_id,
            granted_tokens + bonus_granted_tokens AS granted_tokens,
            reserved_tokens, consumed_tokens
     FROM subscription_usage_allowances
     WHERE id = $1
     FOR UPDATE`,
    [input.allowanceId],
  );
  const row = locked.rows[0];
  if (
    !row ||
    row.subscription_id !== input.subscriptionId ||
    row.plan_version_id !== input.planVersionId
  ) {
    throw new Error("SUBSCRIPTION_ALLOWANCE_PROVENANCE_MISMATCH");
  }
  const beforeState: TokenAllowanceState = {
    grantedTokens: safe(row.granted_tokens, "granted_tokens"),
    reservedTokens: safe(row.reserved_tokens, "reserved_tokens"),
    consumedTokens: safe(row.consumed_tokens, "consumed_tokens"),
  };
  const afterState: TokenAllowanceState = {
    ...beforeState,
    reservedTokens:
      beforeState.reservedTokens - input.allowanceReservedTokens,
  };
  tokenLedgerSnapshot(afterState);
  const result = await client.query(
    `UPDATE subscription_usage_allowances
     SET reserved_tokens = reserved_tokens - $2,
         version = version + 1, updated_at = NOW()
     WHERE id = $1 AND reserved_tokens >= $2`,
    [input.allowanceId, input.allowanceReservedTokens],
  );
  if (result.rowCount !== 1) {
    throw new Error("SUBSCRIPTION_ALLOWANCE_RELEASE_INVARIANT");
  }
  await appendSubscriptionTokenLedgerEntryOnClient(client, {
    platformUserId: input.platformUserId,
    subscriptionId: input.subscriptionId,
    planVersionId: input.planVersionId,
    allowanceId: input.allowanceId,
    gatewayRequestId,
    requestSequence: 2,
    entryType: "release",
    amountTokens: input.allowanceReservedTokens,
    before: tokenLedgerSnapshot(beforeState),
    after: tokenLedgerSnapshot(afterState),
    idempotencyKey: `${gatewayRequestId}:token:release`,
    metadata: { coverageMode: input.coverageMode },
  });
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
    gatewayRequestId?: string;
    platformUserId?: string;
    subscriptionId?: string;
    planVersionId?: string;
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
    subscription_id: string;
    plan_version_id: string | null;
    granted_tokens: string | number;
    reserved_tokens: string | number;
    consumed_tokens: string | number;
    granted_microusd: string | number;
    reserved_microusd: string | number;
    consumed_microusd: string | number;
  }>(
    `SELECT subscription_id, plan_version_id,
            granted_tokens + bonus_granted_tokens AS granted_tokens,
            reserved_tokens, consumed_tokens,
            granted_microusd, reserved_microusd, consumed_microusd
     FROM subscription_usage_allowances WHERE id = $1 FOR UPDATE`,
    [input.allowanceId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("SUBSCRIPTION_ALLOWANCE_NOT_FOUND");
  const reservedTokens = safe(row.reserved_tokens, "reserved_tokens");
  const reservedMoney = safe(row.reserved_microusd, "reserved_microusd");
  if (input.coverageMode === "token_allowance") {
    if (
      !input.gatewayRequestId ||
      !input.platformUserId ||
      !input.subscriptionId ||
      !input.planVersionId ||
      row.subscription_id !== input.subscriptionId ||
      row.plan_version_id !== input.planVersionId
    ) {
      throw new Error("SUBSCRIPTION_TOKEN_LEDGER_PROVENANCE_REQUIRED");
    }
    if (reservedTokens < input.reservedTokens) {
      throw new Error("SUBSCRIPTION_ALLOWANCE_SETTLEMENT_INVARIANT");
    }
    const beforeState: TokenAllowanceState = {
      grantedTokens: safe(row.granted_tokens, "granted_tokens"),
      reservedTokens,
      consumedTokens: safe(row.consumed_tokens, "consumed_tokens"),
    };
    const availableIncludingRequest =
      beforeState.grantedTokens -
      beforeState.consumedTokens -
      (reservedTokens - input.reservedTokens);
    const allowanceChargedTokens = Math.min(
      input.actualTokens,
      Math.max(0, availableIncludingRequest),
    );
    await client.query(
      `UPDATE subscription_usage_allowances
       SET reserved_tokens = reserved_tokens - $2,
           consumed_tokens = consumed_tokens + $3,
           version = version + 1, updated_at = NOW()
       WHERE id = $1`,
      [input.allowanceId, input.reservedTokens, allowanceChargedTokens],
    );
    const capturedFromReservation = Math.min(
      input.reservedTokens,
      allowanceChargedTokens,
    );
    const captureState: TokenAllowanceState = {
      grantedTokens: beforeState.grantedTokens,
      reservedTokens: beforeState.reservedTokens - capturedFromReservation,
      consumedTokens:
        beforeState.consumedTokens + allowanceChargedTokens,
    };
    const releasedTokens = input.reservedTokens - capturedFromReservation;
    const finalState: TokenAllowanceState = {
      ...captureState,
      reservedTokens: captureState.reservedTokens - releasedTokens,
    };
    const beforeSnapshot = tokenLedgerSnapshot(beforeState);
    const captureSnapshot = tokenLedgerSnapshot(captureState);
    const finalSnapshot = tokenLedgerSnapshot(finalState);
    if (allowanceChargedTokens > 0) {
      await appendSubscriptionTokenLedgerEntryOnClient(client, {
        platformUserId: input.platformUserId,
        subscriptionId: input.subscriptionId,
        planVersionId: input.planVersionId,
        allowanceId: input.allowanceId,
        gatewayRequestId: input.gatewayRequestId,
        requestSequence: 2,
        entryType: "capture",
        amountTokens: allowanceChargedTokens,
        before: beforeSnapshot,
        after: captureSnapshot,
        idempotencyKey: `${input.gatewayRequestId}:token:capture`,
        metadata: {
          coverageMode: input.coverageMode,
          actualTokens: input.actualTokens,
        },
      });
    }
    if (releasedTokens > 0) {
      await appendSubscriptionTokenLedgerEntryOnClient(client, {
        platformUserId: input.platformUserId,
        subscriptionId: input.subscriptionId,
        planVersionId: input.planVersionId,
        allowanceId: input.allowanceId,
        gatewayRequestId: input.gatewayRequestId,
        requestSequence: allowanceChargedTokens > 0 ? 3 : 2,
        entryType: "release",
        amountTokens: releasedTokens,
        before:
          allowanceChargedTokens > 0 ? captureSnapshot : beforeSnapshot,
        after: finalSnapshot,
        idempotencyKey: `${input.gatewayRequestId}:token:release`,
        metadata: {
          coverageMode: input.coverageMode,
          actualTokens: input.actualTokens,
        },
      });
    }
    return {
      cashChargeMicrousd: 0,
      allowanceChargeMicrousd: 0,
      allowanceChargedTokens,
    };
  }

  // Rolling-deploy compatibility for requests reserved before the Token-only
  // migration. The resolver never creates new money_allowance requests.
  if (input.coverageMode === "money_allowance") {
    if (reservedMoney < input.reservedMicrousd) {
      throw new Error("SUBSCRIPTION_ALLOWANCE_SETTLEMENT_INVARIANT");
    }
    const availableIncludingRequest =
      safe(row.granted_microusd, "granted_microusd") -
      safe(row.consumed_microusd, "consumed_microusd") -
      (reservedMoney - input.reservedMicrousd);
    const allowanceChargeMicrousd = Math.min(
      input.chargeMicrousd,
      Math.max(0, availableIncludingRequest),
    );
    await client.query(
      `UPDATE subscription_usage_allowances
       SET reserved_microusd = reserved_microusd - $2,
           consumed_microusd = consumed_microusd + $3,
           version = version + 1, updated_at = NOW()
       WHERE id = $1`,
      [input.allowanceId, input.reservedMicrousd, allowanceChargeMicrousd],
    );
    return {
      cashChargeMicrousd: input.chargeMicrousd - allowanceChargeMicrousd,
      allowanceChargeMicrousd,
      allowanceChargedTokens: 0,
    };
  }

  return {
    cashChargeMicrousd: input.chargeMicrousd,
    allowanceChargeMicrousd: 0,
    allowanceChargedTokens: 0,
  };
}
