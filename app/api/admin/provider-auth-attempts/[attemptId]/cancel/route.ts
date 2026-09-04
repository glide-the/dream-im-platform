// [Input] Managed-auth attempt id and a strict authenticated cancellation request.
// [Output] An audited terminal attempt with all temporary authorization ciphertext cleared.
// [Pos] Thin Admin route; cancellation fencing and persistence live in app/lib/admin.
// [Sync] 2026-09-04: add the explicit managed-auth cancel route.

import { handleProviderManagedAuthCancel } from "@/lib/admin/provider-managed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ attemptId: string }> },
) {
  const { attemptId } = await context.params;
  return await handleProviderManagedAuthCancel(request, attemptId);
}
