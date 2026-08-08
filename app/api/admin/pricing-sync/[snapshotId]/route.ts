import { handlePricingSyncSnapshot } from "../../../../lib/admin/pricing-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  return await handlePricingSyncSnapshot(request, snapshotId);
}
