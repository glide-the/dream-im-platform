// [Input] Managed-auth attempt id and a strict authenticated poll request.
// [Output] A lease-fenced, secret-safe Device authorization state transition.
// [Pos] Thin Admin route; the browser never polls an identity provider directly.
// [Sync] 2026-09-04: add the explicit managed-auth poll route.

import { handleProviderManagedAuthPoll } from "@/lib/admin/provider-managed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> },
) {
  const { attemptId } = await context.params;
  return await handleProviderManagedAuthPoll(request, attemptId);
}
