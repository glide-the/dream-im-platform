import type { PoolClient } from "pg";

import { withPlatformTransaction } from "../platform-db";
import { settleSubscriptionAllowanceOnClient } from "../subscriptions/gateway";

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
};

export type UnknownUsageResolution = {
  requestId: string;
  outcome: "conservative_capture" | "idempotent";
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
  const result = await client.query<UnknownUsageRequest>(
    `SELECT id, status, settled_at, completed_at, platform_user_id,
            subscription_id, subscription_plan_version_id,
            subscription_allowance_id, subscription_coverage_mode,
            allowance_reserved_tokens, allowance_reserved_microusd,
            response_summary
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
     SET allowance_charged_tokens = $2,
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
      const due = await client.query<{ id: string }>(
        `SELECT id
         FROM gateway_requests
         WHERE status = 'settlement_failed'
           AND settled_at IS NULL
           AND subscription_coverage_mode = 'token_allowance'
           AND completed_at <= $1
         ORDER BY completed_at ASC, id ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [cutoff],
      );
      const row = due.rows[0];
      if (!row) return null;
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
