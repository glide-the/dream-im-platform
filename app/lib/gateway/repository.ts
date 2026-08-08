import { InsufficientBalanceError } from "../billing/accounting";
import { reserveGatewayRequestOnClient } from "../billing/repository";
import type { InputTokenSemantics } from "../billing/types";
import type { ResolvedBillableModel } from "../models/resolver";
import { withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import type { GatewayPrincipal } from "./auth";

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
      code:
        | "INSUFFICIENT_BALANCE"
        | "REQUEST_RATE_LIMIT_EXCEEDED"
        | "DAILY_TOKEN_LIMIT_EXCEEDED"
        | "MONTHLY_TOKEN_LIMIT_EXCEEDED";
      availableMicrousd?: number;
      requiredMicrousd?: number;
      limit?: number;
      current?: number;
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
      return { window, current };
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
    await client.query(
      `INSERT INTO gateway_requests (
         id, idempotency_key, platform_user_id, gateway_api_key_id,
         provider_id, model_id, pricing_rule_id, protocol,
         requested_model, resolved_model, input_token_semantics, estimated_tokens,
         input_price_snapshot, output_price_snapshot,
         cache_read_price_snapshot, cache_write_price_snapshot,
         markup_bps_snapshot, discount_bps_snapshot, is_streaming
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
         $12, $13, $14, $15, $16, $17, $18, $19
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

    const at = new Date();
    const limiter = await lockLimitWindows({
      client,
      platformUserId: input.principal.platformUserId,
      modelId: input.resolved.model.id,
      at,
      estimatedTokens: input.estimatedTokens,
      ...input.limits,
    });
    if ("window" in limiter) {
      await client.query(
        `UPDATE gateway_requests
         SET status = 'rejected', outcome = 'failed', http_status = 429,
             error_code = $2, error_message = 'Gateway usage limit exceeded',
             completed_at = NOW(), settled_at = NOW()
         WHERE id = $1`,
        [requestId, limiter.window.errorCode],
      );
      return {
        kind: "rejected",
        requestId,
        code: limiter.window.errorCode,
        limit: limiter.window.limit,
        current: limiter.current,
      };
    }

    if (input.reservationMicrousd === 0) {
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
      return { kind: "reserved", requestId, reservedMicrousd: 0 };
    }

    try {
      await reserveGatewayRequestOnClient(client, {
        platformUserId: input.principal.platformUserId,
        gatewayRequestId: requestId,
        amountMicrousd: input.reservationMicrousd,
      });
      await applyLimitReservations({
        client,
        platformUserId: input.principal.platformUserId,
        modelId: input.resolved.model.id,
        windows: limiter.windows,
      });
      return {
        kind: "reserved",
        requestId,
        reservedMicrousd: input.reservationMicrousd,
      };
    } catch (error) {
      if (!(error instanceof InsufficientBalanceError)) throw error;
      await client.query(
        `UPDATE gateway_requests
         SET status = 'rejected', outcome = 'failed', http_status = 402,
             error_code = 'INSUFFICIENT_BALANCE',
             error_message = 'Account balance is insufficient for this request',
             completed_at = NOW(), settled_at = NOW()
         WHERE id = $1`,
        [requestId],
      );
      return {
        kind: "rejected",
        requestId,
        code: "INSUFFICIENT_BALANCE",
        availableMicrousd: error.availableMicrousd,
        requiredMicrousd: error.requiredMicrousd,
      };
    }
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
