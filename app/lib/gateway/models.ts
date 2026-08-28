// [Input] Authenticated Gateway subject plus Admin-owned model/billing PostgreSQL state.
// [Output] Strict callable model catalog with server-only nullable Claude Code Runtime settings.
// [Pos] Public Gateway catalog consumed by Dream; secrets and upstream identity remain excluded.
// [Sync] 2026-08-28: project exact compact/context fields after validating the Admin 0041 capability.

import { withPlatformClient } from "../platform-db";
import { claudeCodeRuntimeCapabilityAvailable } from "../db/claude-code-runtime-capability";
import { authenticateGatewayRequest } from "./auth";
import { GatewayError, gatewayErrorResponse } from "./errors";

export type ModelAvailability =
  | "included"
  | "upgrade_required"
  | "subscription_inactive"
  | "allowance_exhausted"
  | "permission_denied"
  | "maintenance";

export type ModelCatalogRow = {
  code: string;
  display_name: string;
  protocol: "anthropic" | "openai";
  context_window: number | null;
  max_output_tokens: number | null;
  claude_code_auto_compact_window: number | null;
  claude_code_max_context_tokens: number | null;
  capabilities: Record<string, boolean> | null;
  provider_ready: boolean;
  pricing_ready: boolean;
  subscription_id: string | null;
  subscription_status: string | null;
  current_period_start: Date | null;
  current_period_end: Date | null;
  trial_ends_at: Date | null;
  grace_ends_at: Date | null;
  version_ready: boolean;
  entitlement_id: string | null;
  entitlement_is_default: boolean;
  permission_enabled: boolean | null;
  allowance_id: string | null;
  remaining_tokens: string | number | null;
  required_plan_code: string | null;
};

export function evaluateModelAvailability(row: ModelCatalogRow, at = new Date()): {
  callable: boolean;
  availability: ModelAvailability;
} {
  if (!row.provider_ready || !row.pricing_ready) {
    return { callable: false, availability: "maintenance" };
  }
  const subscriptionCallable =
    row.subscription_id !== null
    && row.version_ready
    && row.current_period_start !== null
    && row.current_period_end !== null
    && row.current_period_start <= at
    && row.current_period_end > at
    && (
      row.subscription_status === "active"
      || row.subscription_status === "cancel_at_period_end"
      || (row.subscription_status === "trial"
        && row.trial_ends_at !== null && row.trial_ends_at > at)
      || (row.subscription_status === "past_due"
        && row.grace_ends_at !== null && row.grace_ends_at > at)
    );
  if (!subscriptionCallable) {
    return { callable: false, availability: "subscription_inactive" };
  }
  if (row.permission_enabled === false) {
    return { callable: false, availability: "permission_denied" };
  }
  if (!row.allowance_id) {
    return { callable: false, availability: "subscription_inactive" };
  }
  const remaining = Number(row.remaining_tokens ?? 0);
  if (!Number.isSafeInteger(remaining) || remaining <= 0) {
    return { callable: false, availability: "allowance_exhausted" };
  }
  return { callable: true, availability: "included" };
}

export async function listAvailableGatewayModels(input: {
  platformUserId: string;
  userTier: string;
}) {
  return await withPlatformClient(async (client) => {
    if (!await claudeCodeRuntimeCapabilityAvailable(client)) {
      throw new GatewayError(
        "CLAUDE_CODE_RUNTIME_CAPABILITY_UNAVAILABLE",
        "The Claude Code Runtime model catalog is unavailable",
        503,
        "configuration_error",
        true,
      );
    }
    const { rows } = await client.query<ModelCatalogRow>(
      `SELECT model.code, model.display_name, provider.protocol,
              model.context_window, model.max_output_tokens,
              model.claude_code_auto_compact_window,
              model.claude_code_max_context_tokens,
              model.capabilities,
              (
                provider.status = 'active'
                AND provider.api_key_ciphertext IS NOT NULL
                AND provider.api_key_iv IS NOT NULL
                AND provider.api_key_tag IS NOT NULL
              ) AS provider_ready,
              EXISTS (
                SELECT 1 FROM ai_pricing_rules AS pricing
                WHERE pricing.model_id = model.id
                  AND pricing.status = 'active'
                  AND pricing.user_tier IN ($2, 'default')
                  AND pricing.effective_from <= NOW()
                  AND (pricing.effective_to IS NULL OR pricing.effective_to > NOW())
              ) AS pricing_ready,
              subscription.id AS subscription_id,
              subscription.status AS subscription_status,
              subscription.current_period_start,
              subscription.current_period_end,
              subscription.trial_ends_at,
              subscription.grace_ends_at,
              (
                version.status = 'published'
                AND version.billing_period = 'monthly'
                AND version.allowance_microusd = 0
                AND version.overage_policy = 'deny'
                AND version.effective_from IS NULL
              ) AS version_ready,
              entitlement.id AS entitlement_id,
              COALESCE(entitlement.is_default, FALSE) AS entitlement_is_default,
              permission.enabled AS permission_enabled,
              allowance.id AS allowance_id,
              CASE WHEN allowance.id IS NULL THEN NULL ELSE
                allowance.granted_tokens + allowance.bonus_granted_tokens
                  - allowance.reserved_tokens - allowance.consumed_tokens
              END AS remaining_tokens,
              required_plan.plan_code AS required_plan_code
       FROM ai_models AS model
       JOIN ai_providers AS provider ON provider.id = model.provider_id
       LEFT JOIN LATERAL (
         SELECT candidate.*
         FROM subscriptions AS candidate
         WHERE candidate.platform_user_id = $1
         ORDER BY
           CASE WHEN candidate.status IN ('trial','active','past_due','paused','cancel_at_period_end') THEN 0 ELSE 1 END,
           candidate.created_at DESC
         LIMIT 1
       ) AS subscription ON TRUE
       LEFT JOIN subscription_plan_versions AS version
         ON version.id = subscription.plan_version_id
       LEFT JOIN subscription_plan_entitlements AS entitlement
         ON entitlement.plan_version_id = version.id
        AND entitlement.model_id = model.id
        AND entitlement.enabled = TRUE
        AND entitlement.gateway_scopes @> ARRAY['messages:create']::text[]
       LEFT JOIN user_model_permissions AS permission
         ON permission.platform_user_id = $1
        AND permission.model_id = model.id
       LEFT JOIN subscription_usage_allowances AS allowance
         ON allowance.subscription_id = subscription.id
        AND allowance.period_start = subscription.current_period_start
        AND allowance.period_end = subscription.current_period_end
       LEFT JOIN LATERAL (
         SELECT plan.code AS plan_code
         FROM subscription_plan_entitlements AS plan_entitlement
         JOIN subscription_plan_versions AS plan_version
           ON plan_version.id = plan_entitlement.plan_version_id
         JOIN subscription_plans AS plan ON plan.id = plan_version.plan_id
         WHERE plan_entitlement.model_id = model.id
           AND plan_entitlement.enabled = TRUE
           AND plan_entitlement.gateway_scopes @> ARRAY['messages:create']::text[]
           AND plan.status = 'active'
           AND plan_version.status = 'published'
           AND plan_version.billing_period = 'monthly'
           AND plan_version.allowance_microusd = 0
           AND plan_version.overage_policy = 'deny'
           AND plan_version.effective_from IS NULL
         ORDER BY CASE plan.code
           WHEN 'free' THEN 0 WHEN 'dream' THEN 1 WHEN 'is-dreaming' THEN 2 ELSE 3
         END, plan.code ASC
         LIMIT 1
       ) AS required_plan ON TRUE
       WHERE model.enabled = TRUE
       ORDER BY COALESCE(entitlement.is_default, FALSE) DESC,
                model.display_name ASC, model.code ASC`,
      [input.platformUserId, input.userTier],
    );
    const at = new Date();
    const data = rows.map((row) => {
      const evaluated = evaluateModelAvailability(row, at);
      return {
        id: row.code,
        display_name: row.display_name,
        protocol: row.protocol,
        context_window: row.context_window,
        max_output_tokens: row.max_output_tokens,
        claude_code_auto_compact_window: row.claude_code_auto_compact_window,
        claude_code_max_context_tokens: row.claude_code_max_context_tokens,
        capabilities: row.capabilities ?? {},
        enabled: true as const,
        callable: evaluated.callable,
        availability: evaluated.availability,
        required_plan_code: row.required_plan_code,
        upgrade_hint: evaluated.availability === "upgrade_required" && row.required_plan_code
          ? `View the ${row.required_plan_code} plan`
          : null,
      };
    });
    return {
      data,
      defaultModelAlias: rows.find((row, index) =>
        row.entitlement_is_default && data[index]?.callable)?.code ?? null,
    };
  });
}

export async function handleGatewayModels(request: Request) {
  try {
    const principal = await authenticateGatewayRequest(request.headers, "models:list");
    const catalog = await listAvailableGatewayModels({
      platformUserId: principal.platformUserId,
      userTier: principal.tier,
    });
    return Response.json(
      {
        object: "list",
        data: catalog.data,
        default_model_alias: catalog.defaultModelAlias,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return gatewayErrorResponse(error);
  }
}
