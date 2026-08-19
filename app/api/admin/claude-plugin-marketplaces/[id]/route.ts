// [Input] Authenticated Admin GET/PATCH requests for one global Marketplace source.
// [Output] Thin item Route Handlers delegated to the Marketplace control-plane service.
// [Pos] Admin HTTP boundary for one Remote Marketplace source.
// [Sync] 2026-08-19: expose read and non-destructive source-policy updates.

import {
  handleClaudePluginMarketplaceGet,
  handleClaudePluginMarketplaceUpdate,
} from "../../../../lib/admin/claude-plugin-marketplaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleClaudePluginMarketplaceGet(request, id);
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleClaudePluginMarketplaceUpdate(request, id);
}
