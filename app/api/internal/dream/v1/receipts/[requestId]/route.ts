// [Input] Named operation and original request ID.
// [Output] Strict service-bound committed/absent receipt.
// [Pos] Thin internal recovery route.
import { handleReceipt } from "../../../../../../lib/dream/receiptHandler";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) { return handleReceipt(request, (await context.params).requestId); }
