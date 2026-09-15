// [Input] Original request/name, OAuth write identity and current owned launch source/Run facts.
// [Output] Absent or exact bounded component result; active claim authority is checked before recovery.
// [Pos] Registered launch recovery domain; no caller workspace/actor/source/lease selectors.
// [Sync] 2026-09-15: reuse POST source/frozen/claim validators and reject deleted or expired dispatch authority.
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { principalDto, requestIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository, operationInputDigest } from "./receipts";
import { DreamLaunchSourceRepository } from "./dreamLaunchSourceRepository";
import { dreamLaunchSourceEnsureInputDto, dreamLaunchSourceEnsureOutputDto } from "./dreamLaunchSourceDto";
import { dreamLaunchSourceIdentity } from "./dreamLaunchSourceSemantics";
import { validateExistingDreamLaunchSource } from "./dreamLaunchSourceService";
import { DreamLaunchDispatchRepository } from "./dreamLaunchDispatchRepository";
import { dreamLaunchDispatchOperationContracts, dreamLaunchDispatchClaimOutputDto, dreamLaunchDispatchFinishOutputDto } from "./dreamLaunchDispatchDto";
import { loadDreamLaunchDispatchFacts, requireDreamLaunchWriteActor, validateDreamLaunchClaimResult } from "./dreamLaunchDispatchService";
import { inspectDreamLaunchEnvelope } from "./dreamLaunchDispatchCodec";
import { projectWorkflowTimestamp } from "./workflowRunService";

export function isDreamLaunchReceiptOperation(name: string): name is "dream-launch-source.ensure" | keyof typeof dreamLaunchDispatchOperationContracts {
  return name === "dream-launch-source.ensure" || Object.hasOwn(dreamLaunchDispatchOperationContracts, name);
}
const corrupt = () => { throw new AuthBoundaryError("DREAM_LAUNCH_RECEIPT_INVALID"); };
const bindingConflict = () => { throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409); };
export async function readOriginalDreamLaunchReceipt(tx: DataTransaction, serviceClientId: string, rawPrincipal: z.output<typeof principalDto>, name: string, rawRequestId: string) {
  if (!isDreamLaunchReceiptOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const principal = requireDreamLaunchWriteActor({ principal: rawPrincipal, threadScope: null, runScope: null }), requestId = requestIdDto.parse(rawRequestId);
  const prior = await new ReceiptRepository(tx, serviceClientId, principal.subject).find(name, requestId);
  if (!prior) return { status: "absent" as const, operation: name, request_id: requestId };
  if (prior.editorSessionScope !== null) return bindingConflict();
  let result: unknown;
  if (name === "dream-launch-source.ensure") {
    const parsed = dreamLaunchSourceEnsureOutputDto.safeParse(prior.result); if (!parsed.success) return corrupt(); result = parsed.data;
    const sourceResult = parsed.data.source;
    if (prior.threadScope !== sourceResult.thread_id || prior.runScope !== null) return bindingConflict();
    const store = new DreamLaunchSourceRepository(tx, principal.canonical_user_id), row = await store.existingMessage(sourceResult.message_id);
    if (!row) return corrupt();
    const now = projectWorkflowTimestamp(await store.clock()); if (now === null) return corrupt();
    const metadata = await inspectDreamLaunchEnvelope(row.metadata, now);
    const command = dreamLaunchSourceEnsureInputDto.safeParse({ workspace_id: metadata.workspace_id, deck_id: metadata.deck_id,
      agent_id: metadata.agent_id, goal: metadata.goal, idempotency_key: metadata.idempotency_key });
    if (!command.success || metadata.actor_id !== principal.canonical_user_id || !metadata.agent_valid) return corrupt();
    await store.requireScope(command.data.workspace_id, command.data.deck_id);
    if (prior.inputSha256 !== operationInputDigest(command.data)) return bindingConflict();
    const identity = await dreamLaunchSourceIdentity(principal.canonical_user_id, command.data);
    const current = validateExistingDreamLaunchSource(row, principal.canonical_user_id, command.data, identity);
    if (current.message_id !== sourceResult.message_id || current.thread_id !== sourceResult.thread_id ||
      current.message_time !== sourceResult.message_time || current.request_fingerprint !== sourceResult.request_fingerprint) return bindingConflict();
  } else {
    const parsed = (name === "dream-launch-dispatch.claim" ? dreamLaunchDispatchClaimOutputDto : dreamLaunchDispatchFinishOutputDto).safeParse(prior.result);
    if (!parsed.success) return corrupt(); result = parsed.data;
    if (prior.threadScope !== parsed.data.thread_id || prior.runScope !== parsed.data.workflow_run_id) return bindingConflict();
    const workspaceId = await new DreamLaunchDispatchRepository(tx).ownedWorkspace(principal.canonical_user_id, parsed.data.workflow_run_id);
    if (!workspaceId) throw new AuthBoundaryError("DREAM_LAUNCH_DISPATCH_PERMISSION_DENIED", 403);
    const facts = await loadDreamLaunchDispatchFacts(tx, principal.canonical_user_id, { workspace_id: workspaceId, workflow_run_id: parsed.data.workflow_run_id });
    if (parsed.data.message_id !== facts.sourceFields.message_id || parsed.data.thread_id !== facts.sourceFields.thread_id || parsed.data.workflow_run_id !== facts.sourceFields.workflow_run_id) return bindingConflict();
    if (name === "dream-launch-dispatch.claim") {
      const claim = dreamLaunchDispatchClaimOutputDto.parse(parsed.data);
      let instruction = "";
      if (claim.claimed) {
        let decoded: unknown; try { decoded = JSON.parse(claim.parts_json); } catch { return corrupt(); }
        const parts = z.array(z.strictObject({ type: z.literal("text"), text: z.string().min(1) })).length(1).safeParse(decoded);
        if (!parts.success) return corrupt(); instruction = parts.data[0].text;
      }
      await validateDreamLaunchClaimResult(claim, facts, instruction);
    }
  }
  return { status: "committed" as const, operation: name, request_id: requestId, result };
}
