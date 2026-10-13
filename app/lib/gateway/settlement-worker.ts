// [Sync] 2026-10-11: preserve official Responses reported-Token scope and inclusive cache accounting.
// [Sync] 2026-10-11: recover native inclusive usage despite the outer Messages request row retaining fresh semantics.
// [Input] Usage-unknown or persisted-known Gateway requests and reconciliation policy.
// [Output] Idempotent conservative reservation capture or actual Image Token settlement.
// [Pos] Gateway settlement worker; candidate discovery is lock-free and finalization rechecks under account then request locks.
// [Sync] 2026-10-03: acquire the account gate before the request and allowance rows.
// [Sync] 2026-10-09: recover known Image usage separately without replaying the Provider request.
// [Sync] 2026-10-09: mark conservative unknown-usage capture settled after the Token freeze is closed.

import type { PoolClient } from "pg";

import { withPlatformTransaction } from "../platform-db";
import { settleSubscriptionAllowanceOnClient } from "../subscriptions/gateway";
import { settleGatewayRequestOnClient } from "../billing/repository";
import type { TokenUsage } from "../billing/types";
import { lockGatewayAccountOnClient } from "./account-lock";

type UnknownUsageRequest = {
  id: string;
  status: string;
  settled_at: Date | null;
  completed_at: Date | null;
  platform_user_id: string;
  subscription_id: string | null;
  subscription_plan_version_id: string | null;
  subscription_allowance_id: string | null;
  subscription_coverage_mode: string | null;
  allowance_reserved_tokens: string | number;
  allowance_reserved_microusd: string | number;
  response_summary: Record<string, unknown> | null;
  operation: string;
};

export type UnknownUsageResolution = {
  requestId: string;
  outcome: "conservative_capture" | "actual_usage_capture" | "idempotent";
  capturedTokens: number;
};

function safeTokenCount(value: string | number, field: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`GATEWAY_UNKNOWN_USAGE_${field.toUpperCase()}_INVALID`);
  }
  return parsed;
}

/**
 * Closes an old usage-unknown request without inventing provider usage.
 *
 * The original estimated reservation is conservatively consumed after the
 * reconciliation grace window. Token category counters remain zero/unknown;
 * Product API clients distinguish this terminal record through
 * `settlementState=usageUnknown` and `allowanceConsumedTokens`.
 */
export async function resolveUnknownGatewayUsageOnClient(
  client: PoolClient,
  input: { requestId: string; resolvedAt: Date },
): Promise<UnknownUsageResolution> {
  const identityResult = await client.query<{
    id: string;
    platform_user_id: string;
  }>(
    `SELECT id, platform_user_id
     FROM gateway_requests
     WHERE id = $1`,
    [input.requestId],
  );
  const identity = identityResult.rows[0];
  if (!identity) throw new Error("GATEWAY_UNKNOWN_USAGE_REQUEST_NOT_FOUND");

  await lockGatewayAccountOnClient(client, identity.platform_user_id);

  const result = await client.query<UnknownUsageRequest>(
    `SELECT id, status, settled_at, completed_at, platform_user_id,
            subscription_id, subscription_plan_version_id,
            subscription_allowance_id, subscription_coverage_mode,
            allowance_reserved_tokens, allowance_reserved_microusd,
            response_summary, operation
     FROM gateway_requests
     WHERE id = $1
     FOR UPDATE`,
    [input.requestId],
  );
  const request = result.rows[0];
  if (!request) throw new Error("GATEWAY_UNKNOWN_USAGE_REQUEST_NOT_FOUND");
  const reservedTokens = safeTokenCount(
    request.allowance_reserved_tokens,
    "reserved_tokens",
  );
  if (request.settled_at) {
    return {
      requestId: request.id,
      outcome: "idempotent",
      capturedTokens: reservedTokens,
    };
  }
  if (
    request.status !== "settlement_failed" ||
    request.subscription_coverage_mode !== "token_allowance" ||
    !request.subscription_allowance_id ||
    safeTokenCount(
      request.allowance_reserved_microusd,
      "reserved_microusd",
    ) !== 0
    || request.response_summary?.usageKnown === true
  ) {
    throw new Error("GATEWAY_UNKNOWN_USAGE_REQUEST_NOT_TOKEN_ONLY");
  }

  const allowance = await settleSubscriptionAllowanceOnClient(client, {
    allowanceId: request.subscription_allowance_id,
    coverageMode: request.subscription_coverage_mode,
    reservedTokens,
    reservedMicrousd: 0,
    actualTokens: reservedTokens,
    chargeMicrousd: 0,
    gatewayRequestId: request.id,
    platformUserId: request.platform_user_id,
    subscriptionId: request.subscription_id ?? undefined,
    planVersionId: request.subscription_plan_version_id ?? undefined,
  });
  if (
    allowance.allowanceChargedTokens !== reservedTokens ||
    allowance.allowanceChargeMicrousd !== 0 ||
    allowance.cashChargeMicrousd !== 0
  ) {
    throw new Error("GATEWAY_UNKNOWN_USAGE_CONSERVATIVE_CAPTURE_INVARIANT");
  }

  const updated = await client.query(
    `UPDATE gateway_requests
     SET status = 'settled',
         allowance_charged_tokens = $2,
         allowance_charged_microusd = 0,
         charged_microusd = 0,
         response_summary = COALESCE(response_summary, '{}'::jsonb)
           || jsonb_build_object(
                'usageKnown', false,
                'settlementResolution', 'conservative_estimated_capture',
                'resolvedAt', $3::timestamptz
              ),
         completed_at = COALESCE(completed_at, $3),
         settled_at = $3
     WHERE id = $1
       AND status = 'settlement_failed'
       AND settled_at IS NULL`,
    [request.id, reservedTokens, input.resolvedAt],
  );
  if (updated.rowCount !== 1) {
    throw new Error("GATEWAY_UNKNOWN_USAGE_CONCURRENT_CONFLICT");
  }
  return {
    requestId: request.id,
    outcome: "conservative_capture",
    capturedTokens: reservedTokens,
  };
}

type KnownUsageRequest = {
  id: string;
  operation: string;
  outcome: "failed" | "cancelled";
  input_token_semantics: "fresh" | "total_including_cache";
  input_tokens: string | number;
  output_tokens: string | number;
  cache_read_tokens: string | number;
  cache_write_tokens: string | number;
  input_text_tokens: string | number | null;
  input_image_tokens: string | number | null;
  output_text_tokens: string | number | null;
  output_image_tokens: string | number | null;
  upstream_request_id: string | null;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
  first_token_ms: number | null;
  response_summary: Record<string, unknown> | null;
};

export async function resolveKnownGatewayUsageOnClient(
  client: PoolClient,
  input: { requestId: string },
) {
  const result = await client.query<KnownUsageRequest>(
    `SELECT id, operation, outcome, input_token_semantics,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            input_text_tokens, input_image_tokens,
            output_text_tokens, output_image_tokens,
            upstream_request_id, http_status, error_code, error_message,
            latency_ms, first_token_ms, response_summary
       FROM gateway_requests
      WHERE id = $1 AND status = 'settlement_failed' AND settled_at IS NULL`,
    [input.requestId],
  );
  const row = result.rows[0];
  if (!row || row.response_summary?.usageKnown !== true) {
    throw new Error("GATEWAY_KNOWN_USAGE_REQUEST_NOT_RECOVERABLE");
  }
  const detail = [
    row.input_text_tokens,
    row.input_image_tokens,
    row.output_text_tokens,
    row.output_image_tokens,
  ];
  if (row.operation !== "text" && detail.some((value) => value === null)) {
    throw new Error("GATEWAY_KNOWN_IMAGE_USAGE_DETAILS_REQUIRED");
  }
  const nativeReportedUsage = row.response_summary?.billingScope === "responses_reported_tokens"
    && row.response_summary.requireFullTokenAllowanceCapture === true;
  const usage: TokenUsage = {
    inputTokens: safeTokenCount(row.input_tokens, "input_tokens"),
    outputTokens: safeTokenCount(row.output_tokens, "output_tokens"),
    cacheReadTokens: safeTokenCount(row.cache_read_tokens, "cache_read_tokens"),
    cacheWriteTokens: safeTokenCount(row.cache_write_tokens, "cache_write_tokens"),
    inputTokenSemantics: nativeReportedUsage ? "total_including_cache" : row.input_token_semantics,
    upstreamRequestId: row.upstream_request_id ?? undefined,
    ...(row.operation === "text" ? {} : {
      inputTextTokens: safeTokenCount(row.input_text_tokens!, "input_text_tokens"),
      inputImageTokens: safeTokenCount(row.input_image_tokens!, "input_image_tokens"),
      outputTextTokens: safeTokenCount(row.output_text_tokens!, "output_text_tokens"),
      outputImageTokens: safeTokenCount(row.output_image_tokens!, "output_image_tokens"),
    }),
  };
  const settled = await settleGatewayRequestOnClient(client, {
    gatewayRequestId: row.id,
    usage,
    outcome: row.outcome,
    httpStatus: row.http_status ?? undefined,
    errorCode: row.error_code ?? undefined,
    errorMessage: row.error_message ?? undefined,
    latencyMs: row.latency_ms ?? undefined,
    firstTokenMs: row.first_token_ms ?? undefined,
    responseSummary: {
      ...(row.response_summary ?? {}),
      usageKnown: true,
      settlementResolution: "actual_usage_recovered",
    },
    actorType: "system",
    actorId: "gateway-settlement-worker",
    settlementDescription: "Recover persisted provider usage",
    requireFullTokenAllowanceCapture: row.operation !== "text" || nativeReportedUsage,
  });
  return {
    settled,
    actualTokens: usage.inputTokens + usage.outputTokens,
  };
}

function assertWorkerInput(input: {
  at: Date;
  graceSeconds: number;
  limit: number;
}) {
  if (Number.isNaN(input.at.getTime())) throw new RangeError("at is invalid");
  if (
    !Number.isSafeInteger(input.graceSeconds) ||
    input.graceSeconds < 60 ||
    input.graceSeconds > 604_800
  ) {
    throw new RangeError("graceSeconds must be between 60 and 604800");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500) {
    throw new RangeError("limit must be between 1 and 500");
  }
}

export async function reconcileUnknownGatewayUsage(input?: {
  at?: Date;
  graceSeconds?: number;
  limit?: number;
}): Promise<UnknownUsageResolution[]> {
  const at = input?.at ?? new Date();
  const graceSeconds = input?.graceSeconds ?? 900;
  const limit = input?.limit ?? 100;
  assertWorkerInput({ at, graceSeconds, limit });
  const cutoff = new Date(at.getTime() - graceSeconds * 1_000);
  const resolved: UnknownUsageResolution[] = [];

  for (let index = 0; index < limit; index += 1) {
    const result = await withPlatformTransaction(async (client) => {
      const due = await client.query<{ id: string; usage_known: boolean }>(
        `SELECT id, COALESCE((response_summary ->> 'usageKnown')::boolean, false) AS usage_known
         FROM gateway_requests
         WHERE status = 'settlement_failed'
           AND settled_at IS NULL
           AND subscription_coverage_mode = 'token_allowance'
           AND completed_at <= $1
         ORDER BY completed_at ASC, id ASC
         LIMIT 1`,
        [cutoff],
      );
      const row = due.rows[0];
      if (!row) return null;
      if (row.usage_known) {
        const recovered = await resolveKnownGatewayUsageOnClient(client, {
          requestId: row.id,
        });
        return {
          requestId: row.id,
          outcome: recovered.settled.idempotent
            ? "idempotent" as const
            : "actual_usage_capture" as const,
          capturedTokens: recovered.actualTokens,
        };
      }
      return await resolveUnknownGatewayUsageOnClient(client, {
        requestId: row.id,
        resolvedAt: at,
      });
    });
    if (!result) break;
    resolved.push(result);
  }
  return resolved;
}
