// [Input] Verified actor or task-return service, strict result commands and Admin data transaction.
// [Output] Idempotent target completion, source cards, single claim and fenced terminal settlement.
// [Pos] Task result service; SDK execution and source Thread scheduling remain in Dream.
// [Sync] 2026-09-28: pass owner request identity into late-final card reconciliation.
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { AuthBoundaryError, type DreamServiceClient } from "../auth/config";
import { DelegationService } from "../auth/delegationService";
import { SubjectRepository } from "../auth/subjectRepository";
import type { DataTransaction } from "./database";
import { TaskSessionResultRepository } from "./taskSessionResultRepository";
import { operationInputDigest, operationRequestKeyDigest, ReceiptRepository } from "./receipts";
import { resultClaimInputDto, resultClaimNextOutputDto, resultCommitInputDto, resultListInputDto, resultSettleInputDto } from "./taskSessionResultDto";
import type { z } from "zod";

export async function commitTaskResult(tx: DataTransaction, actor: { canonical_user_id: string },
  input: z.infer<typeof resultCommitInputDto>) {
  return { result: await new TaskSessionResultRepository(tx).commit(input, actor.canonical_user_id) };
}
export async function listTaskResults(tx: DataTransaction, actor: { canonical_user_id: string },
  input: z.infer<typeof resultListInputDto>, requestId: string) {
  return { results: await new TaskSessionResultRepository(tx).list(input.source_thread_id,
    actor.canonical_user_id, requestId) };
}
export async function claimTaskResult(tx: DataTransaction, service: DreamServiceClient,
  input: z.infer<typeof resultClaimInputDto>, claimRequestKey: string | null = null) {
  if (!service.backgroundScopes.includes("task-return:dispatch")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
  const claimed = await new TaskSessionResultRepository(tx).claim(input, claimRequestKey);
  const binding = {
    notificationId: claimed.notificationId, claimId: claimed.claimId,
    actorId: claimed.actorId, threadId: claimed.sourceThreadId,
  };
  const delegations = new DelegationService(tx);
  const sourcePersistenceAuthorization = await delegations.createForTaskResultClaim(service, binding, "server-persistence");
  const sourceGatewayAuthorization = await delegations.createForTaskResultClaim(service, binding, "gateway-cli");
  return { result: claimed.result, actor_id: claimed.actorId, source_session_id: claimed.sourceSessionId,
    source_input_message_id: claimed.sourceInputMessageId, source_input_text: claimed.sourceInputText,
    source_persistence_authorization: sourcePersistenceAuthorization,
    source_gateway_authorization: sourceGatewayAuthorization };
}
export async function settleTaskResult(tx: DataTransaction, service: DreamServiceClient,
  input: z.infer<typeof resultSettleInputDto>) {
  if (!service.backgroundScopes.includes("task-return:dispatch")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
  return { result: await new TaskSessionResultRepository(tx).settle(input) };
}

export async function claimNextTaskResult(tx: DataTransaction, service: DreamServiceClient, requestId: string) {
  if (!service.backgroundScopes.includes("task-return:dispatch")) throw new AuthBoundaryError("DREAM_SERVICE_SCOPE_REQUIRED", 403);
  const repository = new TaskSessionResultRepository(tx);
  const claimRequestKey = operationRequestKeyDigest(service.id, `service:${service.id}`,
    "task-session.result-claim-next", requestId);
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${claimRequestKey}, 0))`);
  const receipts = new ReceiptRepository(tx, service.id, `service:${service.id}`);
  const emptyReceipt = await receipts.find("task-session.result-claim-next", requestId);
  if (emptyReceipt) {
    if (emptyReceipt.inputSha256 !== operationInputDigest({}) || emptyReceipt.threadScope !== null)
      throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
    return resultClaimNextOutputDto.parse(emptyReceipt.result);
  }
  const previous = await repository.byClaimRequestKey(claimRequestKey);
  if (previous) {
    if (previous.status !== "dispatching" || !previous.source_turn_id)
      throw new AuthBoundaryError("TASK_SESSION_RETURN_STATE_UNKNOWN", 409);
    return { claim: await claimTaskResult(tx, service, { notification_id: previous.id,
      expected_revision: previous.revision - 1, source_turn_id: previous.source_turn_id }, claimRequestKey) };
  }
  await repository.reconcileDispatching(service.id, requestId);
  let cursor: { created_at: string; id: string } | null = null;
  for (;;) {
    const candidate = await repository.nextPending(cursor);
    if (!candidate) return receipts.execute("task-session.result-claim-next", requestId, {},
      resultClaimNextOutputDto, async () => ({ claim: null }));
    cursor = { created_at: candidate.created_at, id: candidate.id };
    const actorId = await repository.taskActor(candidate.task_id);
    if (!actorId || !await new SubjectRepository(tx).findActiveByCanonicalUserId(actorId)) continue;
    try {
      return { claim: await claimTaskResult(tx, service, { notification_id: candidate.id,
        expected_revision: candidate.revision, source_turn_id: randomUUID() }, claimRequestKey) };
    } catch (error) {
      if (error instanceof AuthBoundaryError && ["TASK_SESSION_RETURN_INPUT_PENDING",
        "TASK_SESSION_RETURN_DISPATCH_CONFLICT", "TASK_SESSION_RETURN_UNAVAILABLE",
        "TASK_SESSION_RETURN_INPUT_TOO_LARGE"].includes(error.code)) continue;
      throw error;
    }
  }
}
