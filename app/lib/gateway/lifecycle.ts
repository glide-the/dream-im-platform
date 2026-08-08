import {
  markGatewayRequestSettlementFailed,
  settleGatewayRequest,
} from "../billing/repository";
import type { TokenUsage } from "../billing/types";
import { GatewayError } from "./errors";
import {
  providerRequestId,
  toProviderGatewayError,
} from "./provider-clients";
import { emptyTokenUsage, hasBillableTokens } from "./usage";

const DEFINITIVELY_UNBILLED_PROVIDER_ERRORS = new Set([
  "UPSTREAM_RATE_LIMITED",
  "UPSTREAM_REQUEST_REJECTED",
  "UPSTREAM_CREDENTIAL_REJECTED",
]);

export async function finalizeKnownUsage(input: {
  requestId: string;
  usage: TokenUsage;
  outcome: "succeeded" | "failed" | "cancelled";
  httpStatus?: number;
  errorCode?: string;
  errorMessage?: string;
  startedAt: number;
  firstTokenAt?: number;
  responseSummary?: Record<string, unknown>;
}) {
  try {
    return await settleGatewayRequest({
      gatewayRequestId: input.requestId,
      usage: input.usage,
      outcome: input.outcome,
      httpStatus: input.httpStatus,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      latencyMs: Date.now() - input.startedAt,
      firstTokenMs:
        input.firstTokenAt === undefined
          ? undefined
          : input.firstTokenAt - input.startedAt,
      responseSummary: input.responseSummary,
    });
  } catch {
    throw new GatewayError(
      "BILLING_SETTLEMENT_UNAVAILABLE",
      "The model response could not be finalized in the billing ledger",
      503,
      "internal_error",
      true,
    );
  }
}

export async function finalizeUnknownUsage(input: {
  requestId: string;
  outcome: "failed" | "cancelled";
  errorCode: string;
  errorMessage: string;
  httpStatus?: number;
  startedAt: number;
  firstTokenAt?: number;
}) {
  try {
    await markGatewayRequestSettlementFailed({
      gatewayRequestId: input.requestId,
      outcome: input.outcome,
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      httpStatus: input.httpStatus,
      latencyMs: Date.now() - input.startedAt,
      firstTokenMs:
        input.firstTokenAt === undefined
          ? undefined
          : input.firstTokenAt - input.startedAt,
    });
  } catch {
    // The immutable request/error record remains available for an idempotent
    // automated recovery after the database becomes available again.
  }
}

export async function finalizeProviderFailure(input: {
  requestId: string;
  protocol: "anthropic" | "openai";
  error: unknown;
  usage?: TokenUsage;
  startedAt: number;
  firstTokenAt?: number;
  cancelled?: boolean;
}) {
  const mapped = toProviderGatewayError(input.error);
  const usage = input.usage ?? emptyTokenUsage(
    input.protocol === "anthropic" ? "fresh" : "total_including_cache",
  );
  usage.upstreamRequestId ??= providerRequestId(input.error);
  const outcome = input.cancelled ? "cancelled" : "failed";

  if (
    hasBillableTokens(usage) ||
    DEFINITIVELY_UNBILLED_PROVIDER_ERRORS.has(mapped.code)
  ) {
    await finalizeKnownUsage({
      requestId: input.requestId,
      usage,
      outcome,
      httpStatus: mapped.status,
      errorCode: mapped.code,
      errorMessage: mapped.message,
      startedAt: input.startedAt,
      firstTokenAt: input.firstTokenAt,
    });
  } else {
    await finalizeUnknownUsage({
      requestId: input.requestId,
      outcome,
      errorCode: input.cancelled ? "CLIENT_CANCELLED" : mapped.code,
      errorMessage: input.cancelled
        ? "The downstream client cancelled before final usage was available"
        : mapped.message,
      httpStatus: mapped.status,
      startedAt: input.startedAt,
      firstTokenAt: input.firstTokenAt,
    });
  }
  return mapped;
}
