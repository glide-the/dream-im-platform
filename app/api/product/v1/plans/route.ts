import { requireProductPrincipal } from "@/lib/product/auth";
import { plansQuerySchema } from "@/lib/product/contracts";
import { productSuccessResponse } from "@/lib/product/dto";
import { productErrorResponse } from "@/lib/product/errors";
import {
  assertProductOrigin,
  parseStrictQuery,
  productRequestId,
} from "@/lib/product/request";
import { getProductPlans } from "@/lib/product/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = productRequestId(request);
  try {
    assertProductOrigin(request, false);
    const principal = await requireProductPrincipal(request, "product:read");
    const query = parseStrictQuery(request, plansQuerySchema);
    const result = await getProductPlans(principal, query);
    return productSuccessResponse({
      data: result.data,
      meta: result.meta,
      requestId,
      subject: principal.canonicalUserId,
      request,
    });
  } catch (error) {
    return productErrorResponse(error, requestId);
  }
}

