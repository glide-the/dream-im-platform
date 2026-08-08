import { handleProviderDiscoverySnapshot } from "../../../../lib/admin/provider-discovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ snapshotId: string }> },
) {
  const { snapshotId } = await context.params;
  return await handleProviderDiscoverySnapshot(request, snapshotId);
}
