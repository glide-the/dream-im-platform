import { handlePricingSyncApply } from "../../../../../lib/admin/pricing-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  return await handlePricingSyncApply(request, snapshotId);
}
