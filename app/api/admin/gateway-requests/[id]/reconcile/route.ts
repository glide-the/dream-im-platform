import { handleGatewayRequestReconciliation } from "@/lib/admin/reconciliation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleGatewayRequestReconciliation(request, id);
}
