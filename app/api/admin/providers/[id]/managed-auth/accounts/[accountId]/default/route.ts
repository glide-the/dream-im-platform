// [Input] Provider/product context and an obsolete account-default request.
// [Output] An explicit gone response; Provider-owned credentials have no product-wide default.
// [Pos] Compatibility route retained while clients migrate away from shared account pools.
// [Sync] 2026-09-04: retire product default account mutation.

import { handleProviderManagedAuthSetDefault } from "@/lib/admin/provider-managed-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; accountId: string }> },
) {
  const { id, accountId } = await context.params;
  return await handleProviderManagedAuthSetDefault(request, id, accountId);
}
