// [Input] Authenticated Admin GET/POST requests for global ClaudePlugin Marketplace sources.
// [Output] Thin collection Route Handlers delegated to the Marketplace control-plane service.
// [Pos] Admin HTTP boundary for Remote Marketplace source listing and creation.
// [Sync] 2026-08-19: expose the Remote Marketplace v1 collection contract.

import {
  handleClaudePluginMarketplaceCreate,
  handleClaudePluginMarketplaceList,
} from "../../../lib/admin/claude-plugin-marketplaces";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return await handleClaudePluginMarketplaceList(request);
}

export async function POST(request: Request) {
  return await handleClaudePluginMarketplaceCreate(request);
}
