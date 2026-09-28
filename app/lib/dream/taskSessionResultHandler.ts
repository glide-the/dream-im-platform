// [Input] Named task-result request, confidential Dream service and optional exact Thread bearer.
// [Output] Strict Admin result DTO with user- or service-scoped receipt semantics.
// [Pos] Thin task-result ingress; all ownership, final-message and state checks live in the service/repository.
// [Sync] 2026-09-28: preserve request identity for audited owner-scoped result reads.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { hasDelegatedUserBearer } from "../auth/serviceIdentity";
import { withDataTransaction } from "./database";
import { requireDataActor } from "./principal";
import { ReceiptRepository } from "./receipts";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { chatTaskResultSchemaRequirement, chatTaskSessionSchemaRequirement, chatThreadSchemaRequirements } from "./chatThreadService";
import { taskSessionResultContracts, type TaskSessionResultOperation,
  resultClaimInputDto, resultClaimOutputDto, resultCommitInputDto, resultCommitOutputDto,
  resultClaimNextOutputDto, resultListInputDto, resultListOutputDto, resultSettleInputDto, resultSettleOutputDto } from "./taskSessionResultDto";
import { claimNextTaskResult, claimTaskResult, commitTaskResult, listTaskResults, settleTaskResult } from "./taskSessionResultService";

export function isTaskSessionResultOperation(name: string): name is TaskSessionResultOperation {
  return Object.hasOwn(taskSessionResultContracts, name);
}
export async function handleTaskSessionResult(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isTaskSessionResultOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = taskSessionResultContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const delegated = (request.headers.get("authorization") ?? "").startsWith("Bearer idg_");
    const requirements = [identitySchemaRequirement, ...chatThreadSchemaRequirements,
      chatTaskSessionSchemaRequirement, chatTaskResultSchemaRequirement,
      ...(operation.audience === "background" || delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])];
    return withDataTransaction(requirements, async tx => {
      if (operation.audience === "background") {
        if (hasDelegatedUserBearer(request) || request.headers.has("cookie")) throw new AuthBoundaryError("TASK_SESSION_BROWSER_CREDENTIAL_FORBIDDEN", 400);
        if (name === "task-session.result-claim") {
          // The row claim and encrypted source grant are the recoverable receipt.
          // A generic JSON receipt would persist the bearer in plaintext.
          return resultClaimOutputDto.parse(await claimTaskResult(tx, service, resultClaimInputDto.parse(envelope.input)));
        }
        if (name === "task-session.result-claim-next")
          return resultClaimNextOutputDto.parse(await claimNextTaskResult(tx, service, envelope.request_id));
        const input = resultSettleInputDto.parse(envelope.input);
        return new ReceiptRepository(tx, service.id, `service:${service.id}`).execute(name,
          envelope.request_id, input, resultSettleOutputDto, () => settleTaskResult(tx, service, input));
      }
      if (name === "task-session.result-commit") {
        const input = resultCommitInputDto.parse(envelope.input);
        const actor = await requireDataActor(tx, request.headers, service, "dream:write", input.target_thread_id, undefined, name);
        return new ReceiptRepository(tx, service.id, actor.principal.subject).execute(name,
          envelope.request_id, input, resultCommitOutputDto,
          () => commitTaskResult(tx, actor.principal, input), input.target_thread_id);
      }
      const input = resultListInputDto.parse(envelope.input);
      const actor = await requireDataActor(tx, request.headers, service, "dream:read", input.source_thread_id, undefined, name);
      return resultListOutputDto.parse(await listTaskResults(tx, actor.principal, input, envelope.request_id));
    });
  });
}
