import { paymentIntentCreateSchema } from "@/lib/payments/contracts";
import { createProductPaymentIntent } from "@/lib/payments/service";
import { requireProductPrincipal } from "@/lib/product/auth";
import { productSuccessResponse } from "@/lib/product/dto";
import { productErrorResponse } from "@/lib/product/errors";
import {
  assertProductOrigin,
  parseStrictJson,
  productIdempotencyKey,
  productRequestId,
} from "@/lib/product/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = productRequestId(request);
  try {
    assertProductOrigin(request, true);
    const principal = await requireProductPrincipal(request, "product:write");
    const input = await parseStrictJson(request, paymentIntentCreateSchema);
    const idempotencyKey = productIdempotencyKey(request, true)!;
    const data = await createProductPaymentIntent(principal, input, idempotencyKey);
    return productSuccessResponse({
      data,
      requestId,
      subject: principal.canonicalUserId,
      status: 201,
      cache: "no-store",
    });
  } catch (error) {
    return productErrorResponse(error, requestId);
  }
}
