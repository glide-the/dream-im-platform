// [Input] Provider context, its current owned account id, and strict lifecycle fences.
// [Output] Local account tombstone plus an accurate remote revocation outcome.
// [Pos] Thin Admin route; pointer ownership, secret clearing, revoke, and audit live in app/lib/admin.
// [Sync] 2026-09-04: disconnect only the credential directly owned by this Provider.

import { handleProviderManagedAuthDisconnectAccount } from "@/lib/admin/provider-managed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; accountId: string }> },
) {
  const { id, accountId } = await context.params;
  return await handleProviderManagedAuthDisconnectAccount(request, id, accountId);
}
