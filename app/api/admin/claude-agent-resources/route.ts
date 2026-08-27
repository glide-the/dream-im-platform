// [Input] GET/PATCH requests for the dedicated Claude Agent resource console.
// [Output] Delegation to the RBAC-protected Admin domain handlers.
// [Pos] Thin Next.js Route Handler; no generic system_settings CRUD is exposed.

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
