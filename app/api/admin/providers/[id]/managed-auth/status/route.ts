// [Input] Provider id and an authenticated Admin status request.
// [Output] A no-store, secret-safe lifecycle projection for at most one Provider-owned credential.
// [Pos] Thin Admin route; all Provider auth queries and authorization remain in app/lib/admin.
// [Sync] 2026-09-04: expose one Provider-owned credential with pool fields limited to compatibility projections.

import { handleProviderManagedAuthStatus } from "@/lib/admin/provider-managed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleProviderManagedAuthStatus(request, id);
}
