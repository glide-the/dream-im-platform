import { requireProductPrincipal } from "@/lib/product/auth";
import { emptyQuerySchema } from "@/lib/product/contracts";
import { productSuccessResponse } from "@/lib/product/dto";
import { productErrorResponse } from "@/lib/product/errors";
import {
  assertProductOrigin,
  parseStrictQuery,
  productRequestId,
} from "@/lib/product/request";
import { getProductModelCatalog } from "@/lib/product/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = productRequestId(request);
  try {
    assertProductOrigin(request, false);
    const principal = await requireProductPrincipal(request, "product:read");
    parseStrictQuery(request, emptyQuerySchema);
    const data = await getProductModelCatalog(principal);
    return productSuccessResponse({
      data,
      requestId,
      subject: principal.canonicalUserId,
      request,
    });
  } catch (error) {
    return productErrorResponse(error, requestId);
  }
}

