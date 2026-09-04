// [Input] Provider id and a strict, authenticated managed-auth start request.
// [Output] A staged Device authorization attempt without upstream credential disclosure.
// [Pos] Thin Admin route; Origin, RBAC, idempotency, persistence, and audit live in app/lib/admin.
// [Sync] 2026-09-04: new authorization creates one Provider-owned credential; reauthorization must target it explicitly.

import { handleProviderManagedAuthStart } from "@/lib/admin/provider-managed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleProviderManagedAuthStart(request, id);
}
