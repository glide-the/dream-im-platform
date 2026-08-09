import type { InputTokenSemantics } from "../billing/types";
import type { ResolvedBillableModel } from "../models/resolver";
import { withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import type { GatewayPrincipal } from "./auth";
import {
  reserveSubscriptionAllowanceOnClient,
  resolveGatewaySubscriptionOnClient,
  type GatewaySubscriptionContext,
} from "../subscriptions/gateway";

type ExistingRequestRow = {
  id: string;
  status: string;
  outcome: string;
  is_streaming: boolean;
  http_status: number | null;
  response_summary: Record<string, unknown> | null;
  error_code: string | null;
  error_message: string | null;
};

export type BeginGatewayRequestResult =
  | {
      kind: "reserved";
      requestId: string;
      reservedMicrousd: number;
    }
  | {
      kind: "replay";
      request: ExistingRequestRow;
    }
  | {
      kind: "rejected";
      requestId: string;
      code: string;
      status?: 402 | 403 | 409 | 429;
      message?: string;
      availableMicrousd?: number;
      requiredMicrousd?: number;
      metric?: "tokens";
      unit?: "tokens";
      availableTokens?: number;
      requiredTokens?: number;
      periodEnd?: string;
      limit?: number;
      current?: number;
      requested?: number;
      remaining?: number;
      exceededBy?: number;
      limitWindow?: LimitWindow["type"];
      limitMetric?: "requests" | "tokens";
    };

type LimitWindow = {
  type: "minute" | "day" | "month";
  start: Date;
  requestIncrement: number;
  tokenIncrement: number;
  limit?: number;
  errorCode:
    | "REQUEST_RATE_LIMIT_EXCEEDED"
    | "DAILY_TOKEN_LIMIT_EXCEEDED"
    | "MONTHLY_TOKEN_LIMIT_EXCEEDED";
};

function windowStart(type: LimitWindow["type"], at: Date) {
  const start = new Date(at);
  start.setUTCSeconds(0, 0);
  if (type === "day" || type === "month") start.setUTCHours(0, 0, 0, 0);
  if (type === "month") start.setUTCDate(1);
  return start;
}

function optionalMinimum(a?: number, b?: number) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

async function lockLimitWindows(input: {
  client: import("pg").PoolClient;
  platformUserId: string;
  modelId: string;
  at: Date;
  estimatedTokens: number;
  requestsPerMinute?: number;
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
}) {
  const windows: LimitWindow[] = [];
  windows.push({
    type: "day",
    start: windowStart("day", input.at),
    requestIncrement: 0,
    tokenIncrement: input.estimatedTokens,
    limit: input.dailyTokenLimit,
    errorCode: "DAILY_TOKEN_LIMIT_EXCEEDED",
  });
  if (input.requestsPerMinute !== undefined) {
    windows.push({
      type: "minute",
      start: windowStart("minute", input.at),
      requestIncrement: 1,
      tokenIncrement: 0,
      limit: input.requestsPerMinute,
      errorCode: "REQUEST_RATE_LIMIT_EXCEEDED",
    });
  }
  windows.push({
    type: "month",
    start: windowStart("month", input.at),
    requestIncrement: 0,
    tokenIncrement: input.estimatedTokens,
    limit: input.monthlyTokenLimit,
    errorCode: "MONTHLY_TOKEN_LIMIT_EXCEEDED",
  });

  for (const window of windows) {
    await input.client.query(
      `INSERT INTO gateway_rate_limits (
         platform_user_id, model_id, window_type, window_start
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [input.platformUserId, input.modelId, window.type, window.start],
    );
    const { rows } = await input.client.query<{
      request_count: number;
      token_count: string | number;
    }>(
      `SELECT request_count, token_count
       FROM gateway_rate_limits
       WHERE platform_user_id = $1 AND model_id = $2
         AND window_type = $3 AND window_start = $4
       FOR UPDATE`,
      [input.platformUserId, input.modelId, window.type, window.start],
    );
    const row = rows[0];
    if (!row) throw new Error("GATEWAY_LIMIT_WINDOW_NOT_FOUND");
    const current =
      window.requestIncrement > 0 ? row.request_count : Number(row.token_count);
    const increment =
      window.requestIncrement > 0
        ? window.requestIncrement
        : window.tokenIncrement;
    if (!Number.isSafeInteger(current)) {
      throw new Error("GATEWAY_LIMIT_COUNTER_INVALID");
    }
    if (window.limit !== undefined && current + increment > window.limit) {
      return {
        window,
        current,
        limit: window.limit,
        requested: increment,
        remaining: Math.max(0, window.limit - current),
        exceededBy: current + increment - window.limit,
        metric: window.requestIncrement > 0 ? "requests" as const : "tokens" as const,
      };
    }
  }
  return { windows };
}

async function applyLimitReservations(input: {
  client: import("pg").PoolClient;
  platformUserId: string;
  modelId: string;
  windows: LimitWindow[];
}) {
  for (const window of input.windows) {
    await input.client.query(
      `UPDATE gateway_rate_limits
       SET request_count = request_count + $5,
           token_count = token_count + $6,
           updated_at = NOW()
       WHERE platform_user_id = $1 AND model_id = $2
         AND window_type = $3 AND window_start = $4`,
      [
        input.platformUserId,
        input.modelId,
        window.type,
        window.start,
        window.requestIncrement,
        window.tokenIncrement,
      ],
    );
  }
}

export async function beginGatewayRequest(input: {
  principal: GatewayPrincipal;
  resolved: ResolvedBillableModel;
  requestedModel: string;
  protocol: "anthropic" | "openai";
  isStreaming: boolean;
  idempotencyKey?: string;
  reservationMicrousd: number;
  estimatedTokens: number;
  requiredScope: string;
  limits: {
    requestsPerMinute?: number;
    dailyTokenLimit?: number;
    monthlyTokenLimit?: number;
  };
}): Promise<BeginGatewayRequestResult> {
  return await withPlatformTransaction(async (client) => {
    if (input.idempotencyKey) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `${input.principal.platformUserId}:${input.idempotencyKey}`,
      ]);
      const existing = await client.query<ExistingRequestRow>(
        `SELECT id, status, outcome, is_streaming, http_status,
                response_summary, error_code, error_message
         FROM gateway_requests
         WHERE platform_user_id = $1 AND idempotency_key = $2
         LIMIT 1`,
        [input.principal.platformUserId, input.idempotencyKey],
      );
      if (existing.rows[0]) {
        return { kind: "replay", request: existing.rows[0] };
      }
    }

    const requestId = createPlatformId("req");
    const inputTokenSemantics: InputTokenSemantics =
      input.protocol === "anthropic" ? "fresh" : "total_including_cache";
    // Persist the resolved request before subscription policy evaluation. A
    // paused/ineligible/exhausted subscription is still an authenticated
    // Gateway request and needs a stable FK target for its full payloads.
    await client.query(
      `INSERT INTO gateway_requests (
         id, idempotency_key, platform_user_id, gateway_api_key_id,
         provider_id, model_id, pricing_rule_id, protocol,
         requested_model, resolved_model, input_token_semantics, estimated_tokens,
         input_price_snapshot, output_price_snapshot,
         cache_read_price_snapshot, cache_write_price_snapshot,
         markup_bps_snapshot, discount_bps_snapshot, is_streaming
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19
       )`,
      [
        requestId,
        input.idempotencyKey ?? null,
        input.principal.platformUserId,
        input.principal.apiKeyId,
        input.resolved.provider.id,
        input.resolved.model.id,
        input.resolved.pricingRuleId,
        input.protocol,
        input.requestedModel,
        input.resolved.model.upstreamModel,
        inputTokenSemantics,
        input.estimatedTokens,
        input.resolved.pricing.inputPriceMicrousdPerMillion,
        input.resolved.pricing.outputPriceMicrousdPerMillion,
        input.resolved.pricing.cacheReadPriceMicrousdPerMillion,
        input.resolved.pricing.cacheWritePriceMicrousdPerMillion,
        input.resolved.pricing.markupBps,
        input.resolved.pricing.discountBps,
        input.isStreaming,
      ],
    );
    const subscriptionEligibility = await resolveGatewaySubscriptionOnClient(client, {
      platformUserId: input.principal.platformUserId,
      modelId: input.resolved.model.id,
      requiredScope: input.requiredScope,
      estimatedTokens: input.estimatedTokens,
      at: new Date(),
    });
    if ("code" in subscriptionEligibility) {
      await client.query(
        `UPDATE gateway_requests
         SET status = 'rejected', outcome = 'failed', http_status = $2,
             error_code = $3, error_message = $4,
             completed_at = NOW(), settled_at = NOW()
         WHERE id = $1`,
        [
          requestId,
          subscriptionEligibility.status,
          subscriptionEligibility.code,
          subscriptionEligibility.message,
        ],
      );
      return {
        kind: "rejected",
        requestId,
        code: subscriptionEligibility.code,
        status: subscriptionEligibility.status,
        message: subscriptionEligibility.message,
        metric: subscriptionEligibility.metric,
        unit: subscriptionEligibility.unit,
        availableTokens: subscriptionEligibility.availableTokens,
        requiredTokens: subscriptionEligibility.requiredTokens,
        periodEnd: subscriptionEligibility.periodEnd,
      };
    }
    const subscription = subscriptionEligibility as GatewaySubscriptionContext;
    await client.query(
      `UPDATE gateway_requests
         SET subscription_id = $2, subscription_plan_version_id = $3,
             subscription_entitlement_id = $4, subscription_allowance_id = $5,
             subscription_snapshot = $6::jsonb,
             subscription_coverage_mode = $7,
             allowance_reserved_microusd = 0,
             allowance_reserved_tokens = $8
         WHERE id = $1`,
      [
        requestId,
        subscription.subscriptionId,
        subscription.planVersionId,
        subscription.entitlementId,
        subscription.allowanceId,
        JSON.stringify(subscription.snapshot),
        subscription.coverageMode,
        subscription.allowanceReservedTokens,
      ],
    );

    const at = new Date();
    const limiter = await lockLimitWindows({
      client,
      platformUserId: input.principal.platformUserId,
      modelId: input.resolved.model.id,
      at,
      estimatedTokens: input.estimatedTokens,
      requestsPerMinute: optionalMinimum(
        input.limits.requestsPerMinute,
        subscription.limits.requestsPerMinute,
      ),
      dailyTokenLimit: optionalMinimum(
        input.limits.dailyTokenLimit,
        subscription.limits.dailyTokenLimit,
      ),
      monthlyTokenLimit: optionalMinimum(
        input.limits.monthlyTokenLimit,
        subscription.limits.monthlyTokenLimit,
      ),
    });
    if ("window" in limiter) {
      const windowLabel = limiter.window.type === "minute"
        ? "Per-minute request"
        : limiter.window.type === "day"
          ? "Daily token"
          : "Monthly token";
      const errorMessage = `${windowLabel} limit exceeded: current=${limiter.current}, requested=${limiter.requested}, limit=${limiter.limit}, remaining=${limiter.remaining}, exceeded_by=${limiter.exceededBy}`;
      const rejectionSummary = {
        rejection_stage: "preauthorization",
        limit_window: limiter.window.type,
        limit_metric: limiter.metric,
        current: limiter.current,
        requested: limiter.requested,
        limit: limiter.limit,
        remaining: limiter.remaining,
        exceeded_by: limiter.exceededBy,
      };
      await client.query(
        `UPDATE gateway_requests
         SET status = 'rejected', outcome = 'failed', http_status = 429,
             error_code = $2, error_message = $3,
             response_summary = $4::jsonb,
             completed_at = NOW(), settled_at = NOW()
         WHERE id = $1`,
        [
          requestId,
          limiter.window.errorCode,
          errorMessage,
          JSON.stringify(rejectionSummary),
        ],
      );
      return {
        kind: "rejected",
        requestId,
        code: limiter.window.errorCode,
        message: errorMessage,
        limit: limiter.limit,
        current: limiter.current,
        requested: limiter.requested,
        remaining: limiter.remaining,
        exceededBy: limiter.exceededBy,
        limitWindow: limiter.window.type,
        limitMetric: limiter.metric,
      };
    }

    try {
      await reserveSubscriptionAllowanceOnClient(
        client,
        subscription,
        requestId,
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "SUBSCRIPTION_ALLOWANCE_CONCURRENT_CONFLICT"
      ) throw error;
      await client.query(
        `UPDATE gateway_requests
           SET status = 'rejected', outcome = 'failed', http_status = 409,
               error_code = 'SUBSCRIPTION_ALLOWANCE_CONFLICT',
               error_message = 'Subscription allowance changed concurrently',
               completed_at = NOW(), settled_at = NOW()
           WHERE id = $1`,
        [requestId],
      );
      return {
        kind: "rejected",
        requestId,
        code: "SUBSCRIPTION_ALLOWANCE_CONFLICT",
        status: 409,
        message: "Subscription allowance changed concurrently; retry the request",
      };
    }

    await client.query(
      `UPDATE gateway_requests
       SET status = 'reserved', started_at = NOW()
       WHERE id = $1`,
      [requestId],
    );
    await applyLimitReservations({
      client,
      platformUserId: input.principal.platformUserId,
      modelId: input.resolved.model.id,
      windows: limiter.windows,
    });
    return {
      kind: "reserved",
      requestId,
      reservedMicrousd: 0,
    };
  });
}

export async function markGatewayRequestStreaming(requestId: string) {
  return await withPlatformTransaction(async (client) => {
    const result = await client.query(
      `UPDATE gateway_requests
       SET status = 'streaming'
       WHERE id = $1 AND status = 'reserved'`,
      [requestId],
    );
    if (result.rowCount !== 1) {
      throw new Error("GATEWAY_REQUEST_STREAMING_TRANSITION_REJECTED");
    }
  });
}
