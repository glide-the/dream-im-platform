// [Input] Provider id and the retired Provider-scoped disconnect request shape.
// [Output] An explicit account-route-required conflict after RBAC, Origin, and epoch validation.
// [Pos] Compatibility boundary; account removal lives under managed-auth/accounts/:accountId/disconnect.
// [Sync] 2026-09-04: require the current Provider-owned account id for disconnect.

import { handleProviderManagedAuthDisconnect } from "@/lib/admin/provider-managed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleProviderManagedAuthDisconnect(request, id);
}
