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
  created_at: Date;
};

export async function listAvailableGatewayModels(input: {
  platformUserId: string;
  userTier: string;
}) {
  return await withPlatformClient(async (client) => {
    const { rows } = await client.query<ModelListRow>(
      `SELECT m.code, m.display_name, p.protocol, p.code AS provider_code,
              m.context_window, m.max_output_tokens, m.capabilities,
              m.created_at
       FROM ai_models AS m
       JOIN ai_providers AS p ON p.id = m.provider_id
       LEFT JOIN user_model_permissions AS ump
         ON ump.model_id = m.id AND ump.platform_user_id = $1
       WHERE m.enabled = TRUE AND p.status = 'active'
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
