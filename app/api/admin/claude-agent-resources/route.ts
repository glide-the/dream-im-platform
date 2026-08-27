// [Input] GET/PATCH requests for the PostgreSQL-backed Claude Agent resource console.
// [Output] Delegation to the RBAC-protected Admin domain handlers.
// [Pos] Thin Next.js Route Handler; no Dream HTTP or generic system_settings CRUD is exposed.
// [Sync] 2026-08-27: route the PostgreSQL observer projection and optimistic desired mutation.

import {
  handleClaudeAgentResourcesGet,
  handleClaudeAgentResourcesPatch,
} from "../../../lib/admin/claude-agent-resources";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return await handleClaudeAgentResourcesGet(request);
}
export async function PATCH(request: Request) {
  return await handleClaudeAgentResourcesPatch(request);
}
