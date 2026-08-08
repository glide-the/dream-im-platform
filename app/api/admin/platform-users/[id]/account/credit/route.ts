import { handleBillingAdjustment } from "../../../../../../lib/admin/mutations";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleBillingAdjustment(request, id);
}
