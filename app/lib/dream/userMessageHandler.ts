// [Input] Service identity plus scoped user proof and a strict user-turn request envelope.
// [Output] Atomic business result, receipt and audit from the same production data UOW.
// [Pos] Thin named user persistence ingress; no claim or Run state mutation is dispatched here.
// [Sync] 2026-09-15: admit task authority only for the exact user-message persistence operation.
import { z } from "zod";
import { requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { parseAuthDto, handleInternalAuthRequest } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, reflectionTaskSchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { userMessageInputDto, userMessageOutputDto } from "./userMessageDto";
import { requireDataActor } from "./principal";
import { ReceiptRepository } from "./receipts";
import { persistCanonicalUserMessage } from "./userMessageService";

export async function handleUserMessage(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const input = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: userMessageInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES"))); setRequestId(input.request_id);
    const bearer = request.headers.get("authorization") ?? "", delegated = bearer.startsWith("Bearer idg_"), reflectionAuthority = bearer.startsWith("Bearer rta_");
    return withDataTransaction([identitySchemaRequirement, dreamUnifiedSchemaRequirement, ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []), ...(reflectionAuthority ? [reflectionTaskSchemaRequirement] : [])], async tx => {
      const actor = await requireDataActor(tx, request.headers, service, "dream:write", input.input.thread_id, undefined, "chat-user-message.persist");
      return new ReceiptRepository(tx, service.id, actor.principal.subject).execute("chat-user-message.persist", input.request_id, input.input, userMessageOutputDto, () => persistCanonicalUserMessage(tx, actor, input.input), input.input.thread_id);
    });
  });
}
