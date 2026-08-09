import { withPlatformClient } from "../platform-db";
import { authenticateGatewayRequest } from "./auth";
import { gatewayErrorResponse } from "./errors";

type ModelListRow = {
  code: string;
  display_name: string;
  protocol: "anthropic" | "openai";
  provider_code: string;
  context_window: number | null;
  max_output_tokens: number | null;
  capabilities: Record<string, boolean> | null;
  gateway_scopes: string[];
  created_at: Date;
};

export async function listAvailableGatewayModels(input: {
  platformUserId: string;
  userTier: string;
}) {
  return await withPlatformClient(async (client) => {
    const { rows } = await client.query<ModelListRow>(
      `SELECT DISTINCT m.code, m.display_name, p.protocol, p.code AS provider_code,
              m.context_window, m.max_output_tokens, m.capabilities,
              entitlement.gateway_scopes,
              m.created_at
       FROM subscriptions AS subscription
       JOIN subscription_plan_versions AS version
         ON version.id = subscription.plan_version_id
       JOIN subscription_plan_entitlements AS entitlement
         ON entitlement.plan_version_id = version.id
        AND entitlement.enabled = TRUE
       JOIN ai_models AS m
         ON m.id = entitlement.model_id
        AND m.enabled = TRUE
       JOIN ai_providers AS p ON p.id = m.provider_id
       LEFT JOIN user_model_permissions AS ump
         ON ump.model_id = m.id AND ump.platform_user_id = $1
       JOIN subscription_usage_allowances AS allowance
         ON allowance.subscription_id = subscription.id
        AND allowance.period_start = subscription.current_period_start
        AND allowance.period_end = subscription.current_period_end
       WHERE subscription.platform_user_id = $1
         AND (
           subscription.status IN ('active', 'cancel_at_period_end')
           OR (
             subscription.status = 'trial'
             AND subscription.trial_ends_at IS NOT NULL
             AND subscription.trial_ends_at > NOW()
           )
         )
         AND subscription.current_period_start <= NOW()
         AND subscription.current_period_end > NOW()
         AND version.status = 'published'
         AND version.billing_period = 'monthly'
         AND version.allowance_microusd = 0
         AND version.overage_policy = 'deny'
         AND version.effective_from IS NULL
         AND allowance.granted_tokens - allowance.consumed_tokens - allowance.reserved_tokens > 0
         AND p.status = 'active'
         AND p.api_key_ciphertext IS NOT NULL
         AND p.api_key_iv IS NOT NULL
         AND p.api_key_tag IS NOT NULL
         AND COALESCE(ump.enabled, TRUE) = TRUE
         AND EXISTS (
           SELECT 1
           FROM ai_pricing_rules AS pr
           WHERE pr.model_id = m.id AND pr.status = 'active'
             AND pr.user_tier IN ($2, 'default')
             AND pr.effective_from <= NOW()
             AND (pr.effective_to IS NULL OR pr.effective_to > NOW())
         )
       ORDER BY m.display_name ASC, m.code ASC`,
      [input.platformUserId, input.userTier],
    );
    return rows.map((row) => ({
      id: row.code,
      object: "model" as const,
      created: Math.floor(row.created_at.getTime() / 1_000),
      owned_by: row.provider_code,
      display_name: row.display_name,
      protocol: row.protocol,
      context_window: row.context_window,
      max_output_tokens: row.max_output_tokens,
      capabilities: row.capabilities ?? {},
      gateway_scopes: row.gateway_scopes,
    }));
  });
}

export async function handleGatewayModels(request: Request) {
  try {
    const principal = await authenticateGatewayRequest(
      request.headers,
      "models:list",
    );
    const data = await listAvailableGatewayModels({
      platformUserId: principal.platformUserId,
      userTier: principal.tier,
    });
    return Response.json(
      { object: "list", data },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return gatewayErrorResponse(error);
  }
}
