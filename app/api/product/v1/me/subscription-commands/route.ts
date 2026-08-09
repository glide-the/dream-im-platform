import { requireProductPrincipal } from "@/lib/product/auth";
import { subscriptionCommandSchema } from "@/lib/product/contracts";
import { productSuccessResponse } from "@/lib/product/dto";
import { productErrorResponse } from "@/lib/product/errors";
import {
  assertProductOrigin,
  parseStrictJson,
  productIdempotencyKey,
  productRequestId,
} from "@/lib/product/request";
import {
  executeProductSubscriptionCommand,
  previewProductSubscriptionCommand,
} from "@/lib/product/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = productRequestId(request);
  try {
    assertProductOrigin(request, true);
    const principal = await requireProductPrincipal(request, "product:write");
    const command = await parseStrictJson(request, subscriptionCommandSchema);
    const idempotencyKey = productIdempotencyKey(
      request,
      command.phase === "execute",
    );
    const data =
      command.phase === "preview"
        ? await previewProductSubscriptionCommand(principal, command)
        : await executeProductSubscriptionCommand(
            principal,
            command,
            idempotencyKey!,
            requestId,
          );
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

