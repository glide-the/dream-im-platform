// [Input] Authenticated Admin sync command for one HTTPS Git Marketplace source.
// [Output] A persisted immutable revision result or a fail-closed sync error.
// [Pos] Admin HTTP command boundary for bounded remote Marketplace synchronization.
// [Sync] 2026-08-19: expose temporary-clone sync without an object-storage bucket.

import { handleClaudePluginMarketplaceSync } from "../../../../../lib/admin/claude-plugin-marketplaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleClaudePluginMarketplaceSync(request, id);
}
