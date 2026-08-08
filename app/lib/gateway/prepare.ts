import { estimateReservation } from "../billing/money";
import type { AiProviderProtocol } from "../billing/types";
import { resolveBillableModel } from "../models/resolver";
import { authenticateGatewayRequest, type GatewayPrincipal } from "./auth";
import { GatewayError } from "./errors";
import {
  recordGatewayJsonResponse,
  recordGatewayRequestPayload,
  safePayloadWrite,
  type GatewayRequestCapture,
} from "./payloads";
import {
  beginGatewayRequest,
  type BeginGatewayRequestResult,
} from "./repository";

function minimumReserveMicrousd() {
  const raw = process.env.GATEWAY_MIN_RESERVE_MICROUSD;
  if (!raw) return 0;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new GatewayError(
      "GATEWAY_MIN_RESERVE_INVALID",
      "GATEWAY_MIN_RESERVE_MICROUSD must be a non-negative integer",
      503,
      "configuration_error",
    );
  }
  return parsed;
}

function optionalMinimum(a?: number, b?: number) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

export type PreparedGatewayRequest = {
  principal: GatewayPrincipal;
  resolved: Awaited<ReturnType<typeof resolveBillableModel>>;
  requestId: string;
  effectiveMaxOutputTokens: number;
  estimatedTokens: number;
};

export type PrepareGatewayRequestResult =
  | { kind: "ready"; value: PreparedGatewayRequest }
  | Extract<BeginGatewayRequestResult, { kind: "replay" | "rejected" }>;

export async function prepareGatewayRequest(input: {
  headers: Headers;
  requiredScope: string;
  protocol: AiProviderProtocol;
  requestedModel: string;
  isStreaming: boolean;
  idempotencyKey?: string;
  estimatedInputTokens: number;
  requestedMaxOutputTokens?: number | null;
  outputChoices?: number;
  requestCapture?: GatewayRequestCapture;
}): Promise<PrepareGatewayRequestResult> {
  if (
    !Number.isSafeInteger(input.estimatedInputTokens) ||
    input.estimatedInputTokens < 0
  ) {
    throw new GatewayError(
      "REQUEST_TOKEN_ESTIMATE_INVALID",
      "The request token estimate is outside the supported range",
      400,
      "invalid_request_error",
    );
  }
  const principal = await authenticateGatewayRequest(
    input.headers,
    input.requiredScope,
  );
  const resolved = await resolveBillableModel({
    platformUserId: principal.platformUserId,
    requestedModel: input.requestedModel,
    protocol: input.protocol,
  });
  const configuredDefault = resolved.model.maxOutputTokens ?? 4_096;
  const effectiveMaxOutputTokens = Math.min(
    input.requestedMaxOutputTokens ?? configuredDefault,
    configuredDefault,
  );
  if (
    resolved.model.contextWindow !== undefined &&
    input.estimatedInputTokens + effectiveMaxOutputTokens >
      resolved.model.contextWindow
  ) {
    throw new GatewayError(
      "MODEL_CONTEXT_WINDOW_EXCEEDED",
      "The estimated input and maximum output exceed the model context window",
      400,
      "invalid_request_error",
    );
  }
  const outputChoices = input.outputChoices ?? 1;
  const estimatedOutputTokens = effectiveMaxOutputTokens * outputChoices;
  if (!Number.isSafeInteger(estimatedOutputTokens)) {
    throw new GatewayError(
      "REQUEST_TOKEN_ESTIMATE_INVALID",
      "The request token estimate is outside the supported range",
      400,
      "invalid_request_error",
    );
  }
  const estimatedTokens = input.estimatedInputTokens + estimatedOutputTokens;
  if (!Number.isSafeInteger(estimatedTokens)) {
    throw new GatewayError(
      "REQUEST_TOKEN_ESTIMATE_INVALID",
      "The request token estimate is outside the supported range",
      400,
      "invalid_request_error",
    );
  }
  const reservationMicrousd = estimateReservation({
    estimatedInputTokens: input.estimatedInputTokens,
    maxOutputTokens: estimatedOutputTokens,
    pricing: resolved.pricing,
    minimumReserveMicrousd: minimumReserveMicrousd(),
  });
  const result = await beginGatewayRequest({
    principal,
    resolved,
    requestedModel: input.requestedModel,
    protocol: input.protocol,
    isStreaming: input.isStreaming,
    idempotencyKey: input.idempotencyKey,
    reservationMicrousd,
    estimatedTokens,
    requiredScope: input.requiredScope,
    limits: {
      requestsPerMinute: resolved.limits.requestsPerMinute,
      dailyTokenLimit: optionalMinimum(
        resolved.limits.dailyTokenLimit,
        principal.dailyTokenLimit,
      ),
      monthlyTokenLimit: optionalMinimum(
        resolved.limits.monthlyTokenLimit,
        principal.monthlyTokenLimit,
      ),
    },
  });
  // A rejected reservation is still a real application-layer request. The
  // repository has already created its gateway_requests row, so capture the
  // exact request before returning the policy/billing error. Replays point at
  // an older request and must never overwrite that request's original body.
  if (input.requestCapture && result.kind !== "replay") {
    await safePayloadWrite(
      recordGatewayRequestPayload({
        requestId: result.requestId,
        capture: input.requestCapture,
        protocol: input.protocol,
        requestedModel: input.requestedModel,
        providerProtocol: resolved.provider.protocol,
      }),
      result.requestId,
    );
  }
  if (result.kind !== "reserved") return result;
  return {
    kind: "ready",
    value: {
      principal,
      resolved,
      requestId: result.requestId,
      effectiveMaxOutputTokens,
      estimatedTokens,
    },
  };
}

export async function preparationErrorResponse(
  result: Extract<PrepareGatewayRequestResult, { kind: "rejected" | "replay" }>,
  protocol: AiProviderProtocol,
) {
  const requestId = result.kind === "replay" ? result.request.id : result.requestId;
  if (result.kind === "replay") {
    const code = result.request.is_streaming
      ? "STREAM_REPLAY_NOT_SUPPORTED"
      : result.request.status === "settled"
        ? "REQUEST_ALREADY_COMPLETED"
        : "REQUEST_IN_PROGRESS";
    const message =
      code === "REQUEST_IN_PROGRESS"
        ? "A request with this Idempotency-Key is still in progress"
        : "This Idempotency-Key has already been consumed";
    const error = { type: "invalid_request_error", code, message, request_id: requestId };
    const body = protocol === "anthropic"
      ? { type: "error", error, request_id: requestId, request: { id: result.request.id, status: result.request.status, outcome: result.request.outcome, response_summary: result.request.response_summary } }
      : { error, request: { id: result.request.id, status: result.request.status, outcome: result.request.outcome, response_summary: result.request.response_summary } };
    return Response.json(body, {
      status: 409,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        "x-request-id": requestId,
      },
    });
  }

  const insufficient = [
    "INSUFFICIENT_BALANCE",
    "SUBSCRIPTION_ALLOWANCE_EXHAUSTED",
  ].includes(result.code);
  const status = result.status ?? (insufficient ? 402 : 429);
  const error = {
    type:
      status === 402
        ? "billing_error"
        : status === 429
          ? "rate_limit_error"
          : "permission_error",
    code: result.code,
    message:
      result.message ??
      (insufficient
        ? "Account balance or subscription allowance is insufficient for this request"
        : "The configured gateway usage limit has been exceeded"),
    request_id: requestId,
    ...(insufficient
      ? {
          available_microusd: result.availableMicrousd,
          required_microusd: result.requiredMicrousd,
        }
      : {
          limit: result.limit,
          current: result.current,
          requested: result.requested,
          remaining: result.remaining,
          exceeded_by: result.exceededBy,
          limit_window: result.limitWindow,
          limit_metric: result.limitMetric,
        }),
  };
  const body = protocol === "anthropic"
    ? { type: "error", error, request_id: requestId }
    : { error };
  const headers = new Headers({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-request-id": requestId,
    ...(status === 429 ? { "retry-after": "60" } : {}),
  });
  await safePayloadWrite(
    recordGatewayJsonResponse({
      requestId,
      status,
      headers,
      body,
    }),
    requestId,
  );
  return Response.json(body, { status, headers });
}
