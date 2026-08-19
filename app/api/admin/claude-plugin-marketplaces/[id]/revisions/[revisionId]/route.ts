// [Input] Authenticated Admin request for an immutable Marketplace revision and its entries.
// [Output] Revision manifest, validation evidence, entry inventory, and current policy projection.
// [Pos] Admin HTTP read boundary for Remote Marketplace revision review.
// [Sync] 2026-08-19: expose immutable revision inspection before entry approval.

import { handleClaudePluginMarketplaceRevision } from "../../../../../../lib/admin/claude-plugin-marketplaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; revisionId: string }> },
) {
  const { id, revisionId } = await context.params;
  return await handleClaudePluginMarketplaceRevision(request, id, revisionId);
}
