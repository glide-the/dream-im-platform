// [Input] Frozen same-model candidates, public protocol body and persisted request reservation.
// [Output] One accepted transport or bounded explicit-rejection failover with durable attempt evidence.
// [Pos] Pre-response routing only; unknown execution and accepted SSE never switch providers.
import type { ResolvedBillableModel } from "../models/resolver";
import { withPlatformClient } from "../platform-db";
import { adaptProviderRequest, type GatewayProtocol } from "./protocol-adapters";
import { ProviderHttpError, sendProviderRequest } from "./provider-transport";
import { GatewayError } from "./errors";

// HTTP rejection policies, not timers: transport/timeouts are deliberately excluded
// because a missing response cannot prove that generation was never executed.
const fallbackHttpStatuses = new Set([429, 502, 503, 504]);
export function canFallbackProvider(error: unknown) {
  if (!(error instanceof ProviderHttpError) || !fallbackHttpStatuses.has(error.status)) return false;
  // Any usage evidence makes execution ambiguous; even zero/invalid usage is
  // retained by the original lifecycle instead of starting another generation.
  const body = error.responseBody;
  return !body || typeof body !== "object" || !("usage" in body || "response" in body);
}

export async function finishRoutingAttempt(requestId: string, status: string, httpStatus?: number, errorCode?: string) {
  await withPlatformClient(async (client) => {
    await client.query(`UPDATE gateway_requests SET routing_attempts =
      CASE WHEN jsonb_array_length(routing_attempts) > 0 THEN jsonb_set(routing_attempts,
        ARRAY[(jsonb_array_length(routing_attempts)-1)::text],
        (routing_attempts->(jsonb_array_length(routing_attempts)-1)) || $2::jsonb) ELSE routing_attempts END
      WHERE id = $1`, [requestId, JSON.stringify({ status, ...(httpStatus === undefined ? {} : { httpStatus }),
        ...(errorCode === undefined ? {} : { errorCode }), completedAt: new Date().toISOString() })]);
  });
}

export async function sendRoutedProviderRequest(input: {
  resolved: ResolvedBillableModel;
  requestId: string;
  externalProtocol: GatewayProtocol;
  body: Record<string, unknown>;
  maxOutputTokens: number;
  streaming: boolean;
  request: Request;
}) {
  // Legacy callers with no routing snapshot retain their existing transport path.
  const candidates = input.resolved.routing?.candidates ?? [{ provider: input.resolved.provider, upstreamModel: input.resolved.model.upstreamModel }];
  const usable = input.resolved.routing?.snapshot.allowFallbacks ? candidates : candidates.slice(0, 1);
  for (const [index, target] of usable.entries()) {
    const resolved = { ...input.resolved, provider: target.provider, model: { ...input.resolved.model, upstreamModel: target.upstreamModel } };
    if (input.resolved.routing) {
      await withPlatformClient(async (client) => {
        const updated = await client.query(`UPDATE gateway_requests SET provider_id = $2, resolved_model = $3,
          provider_adapter_kind = $4, provider_auth_epoch = $5, provider_credential_revision = $6,
          provider_managed_credential_id = $7, provider_managed_account_auth_epoch = $8,
          provider_renewal_attempted = FALSE,
          routing_attempts = routing_attempts || $9::jsonb WHERE id = $1 AND status IN ('reserved', 'streaming')`,
        [input.requestId, target.provider.id, target.upstreamModel, target.provider.adapterKind ?? "generic",
          target.provider.authEpoch ?? 1, target.provider.credentialRevision ?? 1, target.provider.managedAccountId ?? null,
          target.provider.managedAccountAuthEpoch ?? null, JSON.stringify([{ providerId: target.provider.id, upstreamModel: target.upstreamModel,
            status: "started", startedAt: new Date().toISOString() }])]);
        if (updated.rowCount !== 1) throw new GatewayError("ROUTING_REQUEST_STATE_INVALID", "The request is no longer reserved", 503, "internal_error");
      });
    }
    const body = adaptProviderRequest({ externalProtocol: input.externalProtocol, providerProtocol: target.provider.protocol,
      providerAdapterKind: target.provider.adapterKind, body: { ...input.body, stream: input.streaming,
        ...(input.streaming && target.provider.protocol === "openai" ? { stream_options: { include_usage: true } } : {}) },
      model: target.upstreamModel, maxOutputTokens: input.maxOutputTokens });
    try {
      const transport = await sendProviderRequest({ resolved, body, requestSignal: input.request.signal,
        requestHeaders: input.request.headers, requestUrl: input.request.url, gatewayRequestId: input.requestId,
        allowManagedCredentialRetry: !input.streaming });
      // The consumer must use the selected candidate for response adapters and billing metadata.
      input.resolved.provider = resolved.provider;
      input.resolved.model = resolved.model;
      return transport;
    } catch (error) {
      if (input.resolved.routing) await finishRoutingAttempt(input.requestId, "failed", error instanceof ProviderHttpError ? error.status : undefined,
        error instanceof ProviderHttpError ? `UPSTREAM_HTTP_${error.status}` : "UPSTREAM_EXECUTION_UNKNOWN");
      if (input.request.signal.aborted || !canFallbackProvider(error) || index === usable.length - 1) throw error;
    }
  }
  throw new Error("No frozen routing candidates");
}
