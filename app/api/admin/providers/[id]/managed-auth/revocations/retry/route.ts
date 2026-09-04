// [Input] Provider id plus a strict, authenticated revision-fenced revocation retry request.
// [Output] A secret-free durable revocation job outcome.
// [Pos] Thin Admin route; lease/CAS, encrypted material, remote revoke, and audit remain in app/lib.
// [Sync] 2026-09-04: retry revocation only for a Provider-owned credential job.

import { handleProviderManagedAuthRevocationRetry } from "@/lib/admin/provider-managed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleProviderManagedAuthRevocationRetry(request, id);
}
