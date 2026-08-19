// [Input] Authenticated Admin request for one Marketplace's synchronization history.
// [Output] Newest-first global sync run records without remote repository content.
// [Pos] Admin HTTP read boundary for Remote Marketplace operations evidence.
// [Sync] 2026-08-19: expose persisted sync history.

import { handleClaudePluginMarketplaceRuns } from "../../../../../lib/admin/claude-plugin-marketplaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleClaudePluginMarketplaceRuns(request, id);
}
