import { paymentIntentIdSchema } from "@/lib/payments/contracts";
import { getProductPaymentIntent } from "@/lib/payments/service";
import { requireProductPrincipal } from "@/lib/product/auth";
import { productSuccessResponse } from "@/lib/product/dto";
import { productErrorResponse } from "@/lib/product/errors";
import { assertProductOrigin, productRequestId } from "@/lib/product/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const requestId = productRequestId(request);
  try {
    assertProductOrigin(request, false);
    const principal = await requireProductPrincipal(request, "product:read");
    const { id: rawId } = await context.params;
    const id = paymentIntentIdSchema.parse(rawId);
    const data = await getProductPaymentIntent(principal, id);
    return productSuccessResponse({
      data,
      requestId,
      subject: principal.canonicalUserId,
      cache: "no-store",
    });
  } catch (error) {
    return productErrorResponse(error, requestId);
  }
}
