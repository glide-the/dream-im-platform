// [Input] Authenticated Admin approve/block command for one package in a global Marketplace.
// [Output] Audited entry policy pointing only at a valid immutable revision entry.
// [Pos] Admin HTTP command boundary for Dream-visible Marketplace publication policy.
// [Sync] 2026-08-19: expose fail-closed entry approval and blocking.

import { handleClaudePluginMarketplacePolicy } from "../../../../../../../lib/admin/claude-plugin-marketplaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string; packageName: string }> },
) {
  const { id, packageName } = await context.params;
  return await handleClaudePluginMarketplacePolicy(
    request,
    id,
    decodeURIComponent(packageName),
  );
}
