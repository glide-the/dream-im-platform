// [Input] Public model alias, enabled model/provider state, pricing policy, and Provider authentication state.
// [Output] A revisioned billable model with either generic static or product-managed auth coordinates.
// [Pos] Shared PostgreSQL resolver feeding Gateway transport, billing reservation, and request persistence.
// [Sync] 2026-09-04: resolve only the credential directly owned and selected by the Provider with immutable request fences.

// [Sync] 2026-10-05: freeze same-model routing candidates while preserving alias pricing and permission ownership.
import { orderRoutingTargets, routingConfigSchema, type RoutingSnapshot, type RoutingTarget, targetSupportsModel, type RoutingModelCapability } from "./routing-policy";
import { resolveProviderBaseUrl } from "../gateway/provider-endpoint";
import { resolveProviderAuthMode } from "../gateway/provider-auth";
import type { PoolClient } from "pg";
import type {
  AiProviderProtocol,
  PricingSnapshot,
} from "../billing/types";
import { GatewayError } from "../gateway/errors";
import { withPlatformTransaction } from "../platform-db";
import {
  modelRequestHeadersSchema,
  type ModelRequestHeaders,
} from "./request-headers";

type ModelProviderRow = {
  model_id: string;
  model_code: string;
  upstream_model: string;
  display_name: string;
  context_window: number | null;
  max_output_tokens: number | null;
  capabilities: Record<string, boolean> | null;
  request_headers: unknown;
  provider_status: string;
  provider_id: string;
  provider_code: string;
  protocol: AiProviderProtocol;
  base_url: string | null;
  adapter_kind: "generic" | "codex" | "xai" | "github_copilot";
  active_credential_kind: "static_api_key" | "managed_oauth" | "none";
  auth_epoch: number;
  provider_managed_credential_id: string | null;
  auth_revision: number;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  timeout_ms: number;
  max_retries: number;
  provider_config: Record<string, unknown> | null;
  managed_credential_status: "connected" | "reauth_required" | "disconnected" | null;
  resolved_managed_credential_id: string | null;
  managed_account_auth_epoch: number | null;
  managed_credential_revision: number | null;
};

type PricingRow = {
  id: string;
  input_price_microusd_per_million: string | number;
  output_price_microusd_per_million: string | number;
  cache_read_price_microusd_per_million: string | number;
  cache_write_price_microusd_per_million: string | number;
  markup_bps: number;
  discount_bps: number;
};

function safeDbNumber(value: string | number, name: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new GatewayError(
      "MODEL_PRICING_INVALID",
      `Model pricing field ${name} is invalid`,
      503,
      "configuration_error",
    );
  }
  return parsed;
}

async function loadUser(
  client: PoolClient,
  platformUserId: string,
) {
  const { rows } = await client.query<{
    id: string;
    tier: string;
    status: string;
  }>(
    `SELECT id, tier, status
     FROM platform_users
     WHERE id = $1
     FOR SHARE`,
    [platformUserId],
  );
  const user = rows[0];
  if (!user || user.status !== "active") {
    throw new GatewayError(
      "PLATFORM_USER_INACTIVE",
      "The platform user is not active",
      403,
      "permission_error",
    );
  }
  return user;
}

export type ResolvedBillableModel = {
  model: {
    id: string;
    code: string;
    upstreamModel: string;
    displayName: string;
    contextWindow?: number;
    maxOutputTokens?: number;
    capabilities: Record<string, boolean>;
    requestHeaders: ModelRequestHeaders;
  };
  provider: {
    id: string;
    code: string;
    protocol: AiProviderProtocol;
    baseUrl: string | null;
    adapterKind?: "generic" | "codex" | "xai" | "github_copilot";
    activeCredentialKind?: "static_api_key" | "managed_oauth" | "none";
    authEpoch?: number;
    managedAccountId?: string;
    managedAccountAuthEpoch?: number;
    credentialRevision?: number;
    encryptedCredential?: {
      ciphertext: string;
      iv: string;
      tag: string;
    };
    timeoutMs: number;
    maxRetries: number;
    config: Record<string, unknown>;
  };
  routing?: { snapshot: RoutingSnapshot; candidates: Array<{ provider: ResolvedBillableModel["provider"]; upstreamModel: string }> };
  pricingRuleId: string;
  pricing: PricingSnapshot;
  limits: {
    requestsPerMinute?: number;
    dailyTokenLimit?: number;
    monthlyTokenLimit?: number;
  };
};

function providerReadyReason(row: ModelProviderRow) {
  if (row.provider_status !== "active") return "provider_disabled";
  const generic = row.adapter_kind === "generic" && row.active_credential_kind === "static_api_key"
    && row.api_key_ciphertext && row.api_key_iv && row.api_key_tag;
  const managed = row.active_credential_kind === "managed_oauth" && row.adapter_kind !== "generic"
    && row.managed_credential_status === "connected" && row.managed_credential_revision !== null;
  if (!generic && !managed) return "credential_unavailable";
  if (generic) {
    try {
      resolveProviderBaseUrl({ protocol: row.protocol, baseUrl: row.base_url ?? "" });
      resolveProviderAuthMode({ protocol: row.protocol, config: row.provider_config ?? {} });
    }
    catch { return "endpoint_invalid"; }
  }
  return null;
}

function resolvedProvider(row: ModelProviderRow): ResolvedBillableModel["provider"] {
  return {
    id: row.provider_id, code: row.provider_code, protocol: row.protocol, baseUrl: row.base_url,
    adapterKind: row.adapter_kind, activeCredentialKind: row.active_credential_kind,
    authEpoch: row.auth_epoch, managedAccountId: row.resolved_managed_credential_id ?? undefined,
    managedAccountAuthEpoch: row.managed_account_auth_epoch ?? undefined,
    credentialRevision: row.active_credential_kind === "managed_oauth" ? row.managed_credential_revision ?? undefined : row.auth_revision,
    ...(row.adapter_kind === "generic" && row.api_key_ciphertext && row.api_key_iv && row.api_key_tag ? {
      encryptedCredential: { ciphertext: row.api_key_ciphertext, iv: row.api_key_iv, tag: row.api_key_tag },
    } : {}),
    timeoutMs: row.timeout_ms, maxRetries: row.max_retries, config: row.provider_config ?? {},
  };
}

async function resolveRoutes(client: PoolClient, row: ModelProviderRow) {
  const policy = (await client.query<{ revision: number; effective: unknown }>(
    "SELECT revision, effective FROM ai_model_route_policies WHERE model_id = $1 FOR SHARE", [row.model_id],
  )).rows[0];
  const excluded: RoutingSnapshot["excluded"] = [];
  const defaultTarget = { providerId: row.provider_id, upstreamModel: row.upstream_model, weight: 1 };
  if (!policy?.effective) {
    const reason = providerReadyReason(row);
    if (reason) throw new GatewayError("PROVIDER_CREDENTIAL_UNAVAILABLE", "The default provider is unavailable", 503, "configuration_error");
    return { snapshot: { revision: policy?.revision ?? 0, strategy: "default" as const, allowFallbacks: false, candidates: [defaultTarget], excluded },
      candidates: [{ provider: resolvedProvider(row), upstreamModel: row.upstream_model }] };
  }
  const parsed = routingConfigSchema.safeParse(policy.effective);
  if (!parsed.success) throw new GatewayError("ROUTING_POLICY_INVALID", "The effective routing policy is invalid", 503, "configuration_error");
  const config = parsed.data;
  const providers = (await client.query<ModelProviderRow>(
    `SELECT p.status AS provider_status, p.id AS provider_id, p.code AS provider_code, p.protocol, p.base_url,
      p.adapter_kind, p.active_credential_kind, p.auth_epoch, p.auth_revision,
      p.api_key_ciphertext, p.api_key_iv, p.api_key_tag, p.timeout_ms, p.max_retries, p.config AS provider_config,
      managed.id AS resolved_managed_credential_id, managed.status AS managed_credential_status,
      managed.auth_epoch AS managed_account_auth_epoch, managed.revision AS managed_credential_revision
     FROM ai_providers p LEFT JOIN ai_provider_managed_credentials managed ON managed.provider_id = p.id
       AND managed.adapter_kind = p.adapter_kind AND managed.id = p.managed_credential_id
     WHERE p.id = ANY($1::text[]) FOR SHARE OF p`, [config.targets.map((target) => target.providerId)],
  )).rows;
  const mappedModels = (await client.query<RoutingModelCapability & { provider_id: string; upstream_model: string }>(
    "SELECT provider_id, upstream_model, capabilities, context_window, max_output_tokens FROM ai_models WHERE enabled = TRUE AND provider_id = ANY($1::text[]) FOR SHARE",
    [config.targets.map((target) => target.providerId)],
  )).rows;
  const eligible: RoutingTarget[] = [];
  for (const target of config.targets) {
    const provider = providers.find((value) => value.provider_id === target.providerId);
    const mapped = mappedModels.find((value) => value.provider_id === target.providerId && value.upstream_model === target.upstreamModel);
    const reason = !mapped || !targetSupportsModel(row, mapped) ? "model_capability_incompatible" : !provider ? "provider_missing" : provider.protocol !== row.protocol || provider.adapter_kind !== row.adapter_kind
      ? "protocol_incompatible" : providerReadyReason(provider);
    if (reason) excluded.push({ providerId: target.providerId, reason });
    else eligible.push(target);
  }
  const ordered = orderRoutingTargets(config, eligible);
  if (!ordered.length) throw new GatewayError("ROUTING_NO_CANDIDATE", "No usable provider exists for the effective routing policy", 503, "configuration_error");
  return { snapshot: { revision: policy.revision, strategy: config.strategy, allowFallbacks: config.allowFallbacks, candidates: ordered, excluded },
    candidates: ordered.map((target) => ({ provider: resolvedProvider(providers.find((value) => value.provider_id === target.providerId)!), upstreamModel: target.upstreamModel })) };
}

export async function resolveBillableModel(input: {
  platformUserId: string;
  requestedModel: string;
  protocol: AiProviderProtocol;
  at?: Date;
}): Promise<ResolvedBillableModel> {
  return await withPlatformTransaction(async (client) => {
    const user = await loadUser(client, input.platformUserId);
    const { rows } = await client.query<ModelProviderRow>(
      `SELECT m.id AS model_id, m.code AS model_code, m.upstream_model,
              m.display_name, m.context_window, m.max_output_tokens,
              m.capabilities, m.request_headers, p.id AS provider_id, p.code AS provider_code,
              p.status AS provider_status, p.protocol, p.base_url, p.api_key_ciphertext, p.api_key_iv,
              p.api_key_tag, p.timeout_ms, p.max_retries,
              p.adapter_kind, p.active_credential_kind, p.auth_epoch,
              p.managed_credential_id AS provider_managed_credential_id,
              p.auth_revision, p.config AS provider_config,
              managed.id AS resolved_managed_credential_id,
              managed.status AS managed_credential_status,
              managed.auth_epoch AS managed_account_auth_epoch,
              managed.revision AS managed_credential_revision
       FROM ai_models AS m
       JOIN ai_providers AS p ON p.id = m.provider_id
       LEFT JOIN ai_provider_managed_credentials AS managed
         ON managed.provider_id = p.id
        AND managed.adapter_kind = p.adapter_kind
        AND managed.id = p.managed_credential_id
       WHERE m.code = $1 AND m.enabled = TRUE
       FOR SHARE OF m, p`,
      [input.requestedModel],
    );
    const row = rows[0];
    if (!row) {
      throw new GatewayError(
        "MODEL_NOT_AVAILABLE",
        "The requested model is not available",
        404,
        "invalid_request_error",
      );
    }
    const requestHeaders = modelRequestHeadersSchema.safeParse(row.request_headers ?? {});
    if (!requestHeaders.success) {
      throw new GatewayError(
        "MODEL_REQUEST_HEADERS_INVALID",
        "The selected model has invalid upstream request headers",
        503,
        "configuration_error",
      );
    }

    const permissionResult = await client.query<{
      enabled: boolean;
      requests_per_minute: number | null;
      daily_token_limit: string | number | null;
      monthly_token_limit: string | number | null;
    }>(
      `SELECT enabled, requests_per_minute, daily_token_limit, monthly_token_limit
       FROM user_model_permissions
       WHERE platform_user_id = $1 AND model_id = $2`,
      [input.platformUserId, row.model_id],
    );
    const permission = permissionResult.rows[0];
    if (permission && !permission.enabled) {
      throw new GatewayError(
        "MODEL_PERMISSION_DENIED",
        "The user is not allowed to use the requested model",
        403,
        "permission_error",
      );
    }
    const routing = await resolveRoutes(client, row);

    const at = input.at ?? new Date();
    const pricingResult = await client.query<PricingRow>(
      `SELECT id, input_price_microusd_per_million,
              output_price_microusd_per_million,
              cache_read_price_microusd_per_million,
              cache_write_price_microusd_per_million,
              markup_bps, discount_bps
       FROM ai_pricing_rules
       WHERE model_id = $1
         AND status = 'active'
         AND user_tier IN ($2, 'default')
         AND effective_from <= $3
         AND (effective_to IS NULL OR effective_to > $3)
       ORDER BY CASE WHEN user_tier = $2 THEN 0 ELSE 1 END,
                effective_from DESC
       LIMIT 1
       FOR SHARE`,
      [row.model_id, user.tier, at],
    );
    const pricing = pricingResult.rows[0];
    if (!pricing) {
      throw new GatewayError(
        "MODEL_PRICING_UNAVAILABLE",
        "No effective pricing rule exists for the requested model",
        503,
        "configuration_error",
      );
    }

    return {
      model: {
        id: row.model_id,
        code: row.model_code,
        upstreamModel: routing.candidates[0].upstreamModel,
        displayName: row.display_name,
        contextWindow: row.context_window ?? undefined,
        maxOutputTokens: row.max_output_tokens ?? undefined,
        capabilities: row.capabilities ?? {},
        requestHeaders: requestHeaders.data,
      },
      provider: routing.candidates[0].provider,
      routing,
      pricingRuleId: pricing.id,
      pricing: {
        inputPriceMicrousdPerMillion: safeDbNumber(
          pricing.input_price_microusd_per_million,
          "input",
        ),
        outputPriceMicrousdPerMillion: safeDbNumber(
          pricing.output_price_microusd_per_million,
          "output",
        ),
        cacheReadPriceMicrousdPerMillion: safeDbNumber(
          pricing.cache_read_price_microusd_per_million,
          "cache_read",
        ),
        cacheWritePriceMicrousdPerMillion: safeDbNumber(
          pricing.cache_write_price_microusd_per_million,
          "cache_write",
        ),
        markupBps: pricing.markup_bps,
        discountBps: pricing.discount_bps,
      },
      limits: {
        requestsPerMinute: permission?.requests_per_minute ?? undefined,
        dailyTokenLimit:
          permission?.daily_token_limit === null ||
          permission?.daily_token_limit === undefined
            ? undefined
            : safeDbNumber(permission.daily_token_limit, "daily_token_limit"),
        monthlyTokenLimit:
          permission?.monthly_token_limit === null ||
          permission?.monthly_token_limit === undefined
            ? undefined
            : safeDbNumber(
                permission.monthly_token_limit,
                "monthly_token_limit",
              ),
      },
    };
  });
}
