// [Sync] 2026-09-27: require the exact result capability before returning-task creation.
// [Sync] 2026-09-27: authorize task-session navigation against the current Thread owner.
// [Sync] 2026-09-27: authorize task-session operations against the source Thread owner.
// [Sync] 2026-09-26: require the queue capability only for queue operations.
// [Input] Registered Thread/message operation and strict request envelope.
// [Output] DTO projection with per-request service/user/entity authorization and atomic receipt.
// [Pos] Thin domain ingress; Dream retains runtime execution and SSE ordering.
// [Sync] 2026-09-15: admit task authority only through its exact Chat operation allowlist.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, reflectionTaskSchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { ReceiptRepository } from "./receipts";
import { chatThreadOperationContracts, type ChatThreadOperation } from "./chatThreadDto";
import { chatThreadSchemaRequirements, chatInputQueueSchemaRequirement, chatTaskSessionSchemaRequirement, chatTaskResultSchemaRequirement, runChatThreadOperation } from "./chatThreadService";
export function isChatThreadOperation(name: string): name is ChatThreadOperation { return Object.hasOwn(chatThreadOperationContracts, name); }
export async function handleChatThreadOperation(request: Request, operationName: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isChatThreadOperation(operationName)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = chatThreadOperationContracts[operationName];
    const requestDto = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(requestDto.request_id);
    const bearer = request.headers.get("authorization") ?? "", isDelegated = bearer.startsWith("Bearer idg_"), isReflectionAuthority = bearer.startsWith("Bearer rta_");
    const requirements = [identitySchemaRequirement, ...chatThreadSchemaRequirements, ...(operationName.startsWith("chat-input.") ? [chatInputQueueSchemaRequirement] : []), ...(operationName.startsWith("task-session.") ? [chatTaskSessionSchemaRequirement, chatInputQueueSchemaRequirement] : []), ...(operationName === "task-session.create-returning" ? [chatTaskResultSchemaRequirement] : []), ...(isDelegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []), ...(isReflectionAuthority ? [reflectionTaskSchemaRequirement] : [])];
    return withDataTransaction(requirements, async tx => {
      const input = requestDto.input;
      const threadId = input && typeof input === "object"
        ? ("source_thread_id" in input && typeof input.source_thread_id === "string" ? input.source_thread_id
          : "thread_id" in input && typeof input.thread_id === "string" ? input.thread_id : undefined) : undefined;
      const actor = await requireDataActor(tx, request.headers, service, operation.kind === "read" ? "dream:read" : "dream:write", threadId, undefined, operationName);
      const action = () => runChatThreadOperation(operationName, input, actor, tx);
      if (operation.kind === "read") return action();
      return new ReceiptRepository(tx, service.id, actor.principal.subject).execute(operationName, requestDto.request_id, input, operation.output as z.ZodType, action, threadId ?? null);
    });
  });
}
