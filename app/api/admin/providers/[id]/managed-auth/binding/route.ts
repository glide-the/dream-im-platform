// [Input] Provider id and an obsolete account-pool binding request.
// [Output] An explicit gone response; Provider-owned credentials cannot be rebound.
// [Pos] Compatibility route retained while clients migrate away from shared account pools.
// [Sync] 2026-09-04: retire product-account binding mutation.

import { handleProviderManagedAuthSetBinding } from "@/lib/admin/provider-managed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleProviderManagedAuthSetBinding(request, id);
}
