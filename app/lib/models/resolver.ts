import type { PoolClient } from "pg";
import type {
  AiProviderProtocol,
  PricingSnapshot,
} from "../billing/types";
import { GatewayError } from "../gateway/errors";
import { withPlatformTransaction } from "../platform-db";

type ModelProviderRow = {
  model_id: string;
  model_code: string;
  upstream_model: string;
  display_name: string;
  context_window: number | null;
  max_output_tokens: number | null;
  capabilities: Record<string, boolean> | null;
  provider_id: string;
  provider_code: string;
  protocol: AiProviderProtocol;
  base_url: string;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  timeout_ms: number;
  max_retries: number;
  provider_config: Record<string, unknown> | null;
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
  };
  provider: {
    id: string;
    code: string;
    protocol: AiProviderProtocol;
    baseUrl: string;
    encryptedCredential: {
      ciphertext: string;
      iv: string;
      tag: string;
    };
    timeoutMs: number;
    maxRetries: number;
    config: Record<string, unknown>;
  };
  pricingRuleId: string;
  pricing: PricingSnapshot;
  limits: {
    requestsPerMinute?: number;
    dailyTokenLimit?: number;
    monthlyTokenLimit?: number;
  };
};

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
              m.capabilities, p.id AS provider_id, p.code AS provider_code,
              p.protocol, p.base_url, p.api_key_ciphertext, p.api_key_iv,
              p.api_key_tag, p.timeout_ms, p.max_retries,
              p.config AS provider_config
       FROM ai_models AS m
       JOIN ai_providers AS p ON p.id = m.provider_id
       WHERE m.code = $1 AND m.enabled = TRUE AND p.status = 'active'
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
    if (row.protocol !== input.protocol) {
      throw new GatewayError(
        "MODEL_PROTOCOL_MISMATCH",
        `The requested model is not available through the ${input.protocol} endpoint`,
        400,
        "invalid_request_error",
      );
    }
    if (!row.api_key_ciphertext || !row.api_key_iv || !row.api_key_tag) {
      throw new GatewayError(
        "PROVIDER_CREDENTIAL_UNAVAILABLE",
        "The selected provider has no usable credential",
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
        upstreamModel: row.upstream_model,
        displayName: row.display_name,
        contextWindow: row.context_window ?? undefined,
        maxOutputTokens: row.max_output_tokens ?? undefined,
        capabilities: row.capabilities ?? {},
      },
      provider: {
        id: row.provider_id,
        code: row.provider_code,
        protocol: row.protocol,
        baseUrl: row.base_url,
        encryptedCredential: {
          ciphertext: row.api_key_ciphertext,
          iv: row.api_key_iv,
          tag: row.api_key_tag,
        },
        timeoutMs: row.timeout_ms,
        maxRetries: row.max_retries,
        config: row.provider_config ?? {},
      },
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
