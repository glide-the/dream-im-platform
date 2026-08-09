import { processPaymentWebhook } from "@/lib/payments/service";
import { productErrorResponse } from "@/lib/product/errors";
import { productRequestId } from "@/lib/product/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ adapter: string }> },
) {
  const requestId = productRequestId(request);
  try {
    const { adapter } = await context.params;
    if (!/^[a-z][a-z0-9_-]{1,39}$/.test(adapter)) {
      return Response.json(
        { error: { code: "PAYMENT_ADAPTER_NOT_FOUND", message: "The payment adapter does not exist" }, meta: { requestId } },
        { status: 404, headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > 1_048_576) {
      return Response.json(
        { error: { code: "PAYMENT_WEBHOOK_TOO_LARGE", message: "The payment webhook payload is too large" }, meta: { requestId } },
        { status: 413, headers: { "cache-control": "no-store", "x-request-id": requestId } },
      );
    }
    const data = await processPaymentWebhook(adapter, rawBody, request.headers);
    return Response.json(
      { data, meta: { requestId } },
      { status: 202, headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return productErrorResponse(error, requestId);
  }
}
