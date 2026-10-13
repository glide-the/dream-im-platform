// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Sync] 2026-10-10: separate Image Settings ownership and fail closed on unimplemented Responses images.
// [Sync] 2026-10-10: preserve existing allowance-only text eligibility while retaining independent Images authorization.
// [Sync] 2026-10-05: catalog readiness uses the effective same-model pool instead of a disabled default alone.
// [Input] Authenticated Gateway subject plus Admin-owned model, Provider auth, and billing PostgreSQL state.
// [Output] Strict callable model catalog with product adapter/auth readiness and server-only runtime settings.
// [Pos] Public Gateway catalog consumed by Dream; credentials and upstream account identity remain excluded.
// [Sync] 2026-09-04: managed readiness follows the Provider's directly owned credential pointer.
// [Sync] 2026-10-09: publish endpoint-specific Messages, Chat, and Images availability without secrets.
// [Sync] 2026-10-11: include declared Codex hosted image capabilities without enabling them by adapter name.

import { withPlatformClient } from "../platform-db";
import { claudeCodeRuntimeCapabilityAvailable } from "../db/claude-code-runtime-capability";
import { authenticateGatewayRequest } from "./auth";
import { GatewayError, gatewayErrorResponse } from "./errors";
import { modelSupportsConversation } from "./image-policy";
import { imageTurnCapabilityAvailable } from "../db/image-turn-capability";

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
  image_input_token_reserve_per_image: number | null;
  image_output_token_reserve_per_image: number | null;
  claude_code_auto_compact_window: number | null;
  claude_code_max_context_tokens: number | null;
  capabilities: Record<string, boolean> | null;
  provider_ready: boolean;
  pricing_ready: boolean;
  image_pricing_ready: boolean;
  image_provider_ready: boolean;
  responses_image_provider_ready?: boolean;
  messages_entitled: boolean;
  chat_entitled: boolean;
  images_entitled: boolean;
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
    const nativeContractReady = await imageTurnCapabilityAvailable(client);
    const { rows } = await client.query<ModelCatalogRow>(
      `SELECT model.code, model.display_name, provider.protocol,
              model.context_window, model.max_output_tokens,
              model.image_input_token_reserve_per_image,
              model.image_output_token_reserve_per_image,
              model.claude_code_auto_compact_window,
              model.claude_code_max_context_tokens,
              model.capabilities,
              (provider.protocol = 'openai'
               AND (provider.adapter_kind = 'codex' OR (provider.adapter_kind = 'generic'
                 AND provider.config @> '{"openaiApi":"responses"}'::jsonb))
               AND route_policy.effective IS NULL) AS responses_image_provider_ready,
              CASE WHEN route_policy.effective IS NOT NULL THEN EXISTS (
                SELECT 1 FROM ai_model_route_targets target JOIN ai_providers candidate ON candidate.id = target.provider_id
                JOIN ai_models supply ON supply.provider_id = candidate.id AND supply.upstream_model = target.upstream_model
                WHERE target.model_id = model.id AND candidate.status = 'active'
                  AND supply.enabled = TRUE
                  AND (model.context_window IS NULL OR supply.context_window >= model.context_window)
                  AND (model.max_output_tokens IS NULL OR supply.max_output_tokens >= model.max_output_tokens)
                  AND NOT EXISTS (
                    SELECT 1 FROM jsonb_each(COALESCE(model.capabilities, '{}'::jsonb)) requirement
                    WHERE requirement.value = 'true'::jsonb
                      AND COALESCE(supply.capabilities -> requirement.key, 'false'::jsonb) <> 'true'::jsonb
                  )
                  AND candidate.protocol = provider.protocol AND candidate.adapter_kind = provider.adapter_kind
                  AND ((candidate.adapter_kind = 'generic' AND candidate.active_credential_kind = 'static_api_key'
                    AND candidate.api_key_ciphertext IS NOT NULL AND candidate.api_key_iv IS NOT NULL AND candidate.api_key_tag IS NOT NULL)
                    OR (candidate.active_credential_kind = 'managed_oauth' AND EXISTS (
                      SELECT 1 FROM ai_provider_managed_credentials credential WHERE credential.id = candidate.managed_credential_id
                        AND credential.provider_id = candidate.id AND credential.adapter_kind = candidate.adapter_kind AND credential.status = 'connected')))
              ) ELSE (
                provider.status = 'active'
                AND (
                  (
                    provider.adapter_kind = 'generic'
                    AND provider.active_credential_kind = 'static_api_key'
                    AND provider.api_key_ciphertext IS NOT NULL
                    AND provider.api_key_iv IS NOT NULL
                    AND provider.api_key_tag IS NOT NULL
                  )
                  OR (
                    provider.adapter_kind IN ('codex', 'xai', 'github_copilot')
                    AND provider.active_credential_kind = 'managed_oauth'
                    AND EXISTS (
                      SELECT 1
                      FROM ai_provider_managed_credentials AS managed
                      WHERE managed.provider_id = provider.id
                        AND managed.adapter_kind = provider.adapter_kind
                        AND managed.id = provider.managed_credential_id
                        AND managed.status = 'connected'
                    )
                  )
                )
              ) END AS provider_ready,
              EXISTS (
                SELECT 1 FROM ai_pricing_rules AS pricing
                WHERE pricing.model_id = model.id
                  AND pricing.status = 'active'
                  AND pricing.user_tier IN ($2, 'default')
                  AND pricing.effective_from <= NOW()
                  AND (pricing.effective_to IS NULL OR pricing.effective_to > NOW())
              ) AS pricing_ready,
              EXISTS (
                SELECT 1 FROM ai_pricing_rules AS image_pricing
                WHERE image_pricing.model_id = model.id
                  AND image_pricing.status = 'active'
                  AND image_pricing.user_tier IN ($2, 'default')
                  AND image_pricing.effective_from <= NOW()
                  AND (image_pricing.effective_to IS NULL OR image_pricing.effective_to > NOW())
                  AND image_pricing.image_output_price_microusd_per_million IS NOT NULL
                  AND (
                    COALESCE((model.capabilities ->> 'image_edit')::boolean, FALSE) = FALSE
                    OR image_pricing.image_input_price_microusd_per_million IS NOT NULL
                  )
              ) AS image_pricing_ready,
              (
                provider.adapter_kind = 'codex'
                OR (
                  provider.adapter_kind = 'generic'
                  AND provider.protocol = 'openai'
                  AND provider.config @> '{"imageApi":{"kind":"openai"}}'::jsonb
                )
              ) AS image_provider_ready,
              EXISTS (
                SELECT 1 FROM subscription_plan_entitlements AS message_scope
                WHERE message_scope.plan_version_id = version.id
                  AND message_scope.model_id = model.id
                  AND message_scope.enabled = TRUE
                  AND message_scope.gateway_scopes @> ARRAY['messages:create']::text[]
              ) AS messages_entitled,
              EXISTS (
                SELECT 1 FROM subscription_plan_entitlements AS chat_scope
                WHERE chat_scope.plan_version_id = version.id
                  AND chat_scope.model_id = model.id
                  AND chat_scope.enabled = TRUE
                  AND chat_scope.gateway_scopes @> ARRAY['chat:create']::text[]
              ) AS chat_entitled,
              EXISTS (
                SELECT 1 FROM subscription_plan_entitlements AS image_scope
                WHERE image_scope.plan_version_id = version.id
                  AND image_scope.model_id = model.id
                  AND image_scope.enabled = TRUE
                  AND image_scope.gateway_scopes @> ARRAY['images:create']::text[]
              ) AS images_entitled,
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
       LEFT JOIN ai_model_route_policies route_policy ON route_policy.model_id = model.id
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
      const capabilities = row.capabilities ?? {};
      // Text Gateway accepts allowance-only coverage; a missing per-model
      // plan row is not a new permission denial. Images keeps its own scope.
      const textCallable = evaluated.callable && modelSupportsConversation(capabilities);
      const imageConfigured = Boolean(
        (capabilities.image_generation || capabilities.image_edit)
        && row.image_output_token_reserve_per_image
        && (!capabilities.image_edit || row.image_input_token_reserve_per_image)
        && row.image_pricing_ready
        && row.image_provider_ready,
      );
      const responsesImageConfigured = Boolean(nativeContractReady && row.responses_image_provider_ready
        && capabilities.chat === true && capabilities.tools === true
        && (capabilities.responses_image_generation || capabilities.responses_image_edit)
        && row.image_output_token_reserve_per_image
        && (!capabilities.responses_image_edit || row.image_input_token_reserve_per_image));
      return {
        id: row.code,
        display_name: row.display_name,
        protocol: row.protocol,
        context_window: row.context_window,
        max_output_tokens: row.max_output_tokens,
        image_input_token_reserve_per_image:
          row.image_input_token_reserve_per_image,
        image_output_token_reserve_per_image:
          row.image_output_token_reserve_per_image,
        claude_code_auto_compact_window: row.claude_code_auto_compact_window,
        claude_code_max_context_tokens: row.claude_code_max_context_tokens,
        capabilities,
        enabled: true as const,
        callable: evaluated.callable,
        availability: evaluated.availability,
        required_plan_code: row.required_plan_code,
        upgrade_hint: evaluated.availability === "upgrade_required" && row.required_plan_code
          ? `View the ${row.required_plan_code} plan`
          : null,
        endpoint_availability: {
          // This describes the implemented Messages bridge, not the upstream
          // vendor's product name or the independent Images checkbox.
          responses_image: {
            generation: capabilities.responses_image_generation === true,
            edit: capabilities.responses_image_edit === true,
            configured: responsesImageConfigured,
            entitled: row.messages_entitled || textCallable,
            callable: textCallable && responsesImageConfigured,
          },
          messages: {
            callable: textCallable,
            entitled: row.messages_entitled || textCallable,
          },
          chat: {
            callable: textCallable,
            entitled: row.chat_entitled || textCallable,
          },
          images: {
            callable: evaluated.callable && row.images_entitled && imageConfigured,
            entitled: row.images_entitled,
            configured: imageConfigured,
            generation: capabilities.image_generation === true,
            edit: capabilities.image_edit === true,
          },
        },
      };
    });
    return {
      data,
      defaultModelAlias: rows.find((row, index) =>
        row.entitlement_is_default && data[index]?.endpoint_availability.messages.callable)?.code ?? null,
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
