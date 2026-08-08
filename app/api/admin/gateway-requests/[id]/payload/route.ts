import { handleGatewayPayloadDetail } from "../../../../../lib/admin/gateway-payloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return await handleGatewayPayloadDetail(request, id);
}
