// [Input] OAuth write principal, a closed claim/finish command and an existing capability-gated UOW.
// [Output] Atomic envelope claim or current-claim finish with bounded receipt and audit.
// [Pos] Registered metadata domain; Runtime/Voice execution stays outside both committed transactions.
// [Sync] 2026-09-15: derive complete context/source authority and reject stale bounded dispatch grants.
import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import { dreamLaunchProtocolPolicy as policy } from "../../../config/dream-launch-policy";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { ChatThreadActor } from "./chatThreadService";
import { dreamLaunchSourceSchemaRequirements } from "./dreamLaunchSourceService";
import { dreamLaunchSourceEnsureInputDto } from "./dreamLaunchSourceDto";
import { dreamLaunchSourceIdentity } from "./dreamLaunchSourceSemantics";
import { canonicalBusinessJson } from "./deckContentCanonical";
import { WorkflowRunCreationRepository } from "./workflowRunCreationRepository";
import { projectStoredWorkflowRun, projectWorkflowTimestamp } from "./workflowRunService";
import { ReceiptRepository } from "./receipts";
import { DreamLaunchDispatchRepository } from "./dreamLaunchDispatchRepository";
import { inspectDreamLaunchEnvelope, overlayDreamLaunchClaim, overlayDreamLaunchFinish } from "./dreamLaunchDispatchCodec";
import * as dto from "./dreamLaunchDispatchDto";

export const dreamLaunchDispatchSchemaRequirements = dreamLaunchSourceSchemaRequirements;
type Actor = ChatThreadActor & { runScope?: string | null };
const deny = () => { throw new AuthBoundaryError("DREAM_LAUNCH_DISPATCH_PERMISSION_DENIED", 403); };
const conflict = () => { throw new AuthBoundaryError("DREAM_LAUNCH_IDEMPOTENCY_CONFLICT", 409); };

export function requireDreamLaunchWriteActor(actor: Actor) {
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null || (actor.runScope ?? null) !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  return principal;
}
export async function loadDreamLaunchDispatchFacts(tx: DataTransaction, canonicalActor: string, input: { workspace_id: string; workflow_run_id: string }) {
  await new WorkflowRunCreationRepository(tx, canonicalActor, input.workspace_id).assertWorkspace();
  const store = new DreamLaunchDispatchRepository(tx), preview = await store.run(canonicalActor, input.workspace_id, input.workflow_run_id, false);
  if (!preview) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  const binding = await store.binding(preview.deck_plugin_binding_id);
  const rawRun = await store.run(canonicalActor, input.workspace_id, input.workflow_run_id, true);
  if (!rawRun || rawRun.deck_plugin_binding_id !== preview.deck_plugin_binding_id) return conflict();
  const { id, ...storedFields } = rawRun;
  const run = projectStoredWorkflowRun({ ...storedFields, workflow_run_id: id });
  if (run.created_by !== canonicalActor || run.workspace_id !== input.workspace_id || run.workflow_run_id !== input.workflow_run_id) return deny();
  if (run.source_voice_thread_id === null || run.source_message_id === null || run.source_message_time === null) return deny();
  if (!binding || binding.workspace_id !== input.workspace_id || binding.deck_plugin_id !== rawRun.deck_plugin_id ||
    binding.deck_plugin_version !== rawRun.deck_plugin_version || binding.binding_revision !== run.binding_revision) return deny();
  const source = await store.source(run.source_message_id, run.source_voice_thread_id);
  if (!source || source.user_id !== canonicalActor || source.role !== "user" || source.deck_id !== binding.deck_id ||
    projectWorkflowTimestamp(source.created_at) !== run.source_message_time) return deny();
  const now = projectWorkflowTimestamp(await store.clock());
  if (now === null) throw new AuthBoundaryError("DREAM_LAUNCH_DISPATCH_UNAVAILABLE");
  const inspected = await inspectDreamLaunchEnvelope(source.metadata, now);
  if (inspected.kind !== policy.metadataKind || inspected.actor_id !== canonicalActor || inspected.workspace_id !== input.workspace_id ||
    inspected.deck_id !== source.deck_id || !inspected.agent_valid || inspected.agent_id !== source.agent_id) return deny();
  const command = dreamLaunchSourceEnsureInputDto.safeParse({ workspace_id: input.workspace_id, deck_id: inspected.deck_id,
    agent_id: inspected.agent_id, goal: inspected.goal, idempotency_key: inspected.idempotency_key });
  if (!command.success) return deny();
  const identity = await dreamLaunchSourceIdentity(canonicalActor, command.data);
  if (identity.threadId !== source.thread_id || identity.messageId !== source.message_id || identity.requestFingerprint !== inspected.request_fingerprint ||
    command.data.idempotency_key !== run.idempotency_key || (await canonicalBusinessJson(JSON.stringify({ goal: command.data.goal }))).content_hash !== run.input_hash) return conflict();
  if (!inspected.run_valid || (inspected.workflow_run_id !== null && inspected.workflow_run_id !== run.workflow_run_id)) return conflict();
  const context = dto.dreamLaunchDispatchContextDto.safeParse({ workflow_run_id: run.workflow_run_id, thread_id: source.thread_id,
    deck_id: source.deck_id, agent_id: source.agent_id, deck_plugin_id: run.deck_plugin_id, deck_plugin_version: run.deck_plugin_version,
    deck_plugin_binding_id: run.deck_plugin_binding_id, binding_revision: run.binding_revision,
    deck_runtime_snapshot_id: run.deck_runtime_snapshot_id, runtime_plugin_lock_id: run.runtime_plugin_lock_id });
  if (!context.success) throw new AuthBoundaryError("DREAM_LAUNCH_DISPATCH_DATA_INVALID");
  const sourceFields = { workflow_run_id: run.workflow_run_id, thread_id: source.thread_id, message_id: source.message_id };
  const projectSlug = `proj-${createHash("sha256").update(command.data.goal, "utf8").digest("hex").slice(0, 8)}`;
  return { store, source, inspected, run, now, context: context.data, sourceFields, projectSlug };
}
type DispatchFacts = Awaited<ReturnType<typeof loadDreamLaunchDispatchFacts>>;
export async function validateDreamLaunchClaimResult(result: z.output<typeof dto.dreamLaunchDispatchClaimOutputDto>, facts: DispatchFacts, instructionText: string) {
  const { store, source, now, context, sourceFields, projectSlug } = facts;
  if (result.workflow_run_id !== sourceFields.workflow_run_id || result.thread_id !== sourceFields.thread_id || result.message_id !== sourceFields.message_id)
    throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
  if (result.claimed) {
    const current = await store.source(source.message_id, source.thread_id);
    const lease = await inspectDreamLaunchEnvelope(current?.metadata ?? null, now);
    if (!current || lease.dispatch_status !== "dispatching" || lease.claim_id !== result.claim_id || !lease.claim_fresh)
      throw new AuthBoundaryError("DREAM_LAUNCH_CLAIM_STALE", 409);
    const overlay = await overlayDreamLaunchClaim(current.metadata, { context, claim_id: result.claim_id, now, project_slug: projectSlug, instruction_text: instructionText });
    if (result.parts_json !== current.parts || result.metadata_json !== overlay.runtime_metadata_json || JSON.stringify(result.context) !== JSON.stringify(context))
      throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
  }
}
export async function executeDreamLaunchDispatch(operation: dto.DreamLaunchDispatchOperation, rawInput: unknown, actor: Actor, serviceClientId: string, requestId: string, tx: DataTransaction) {
  const principal = requireDreamLaunchWriteActor(actor), contract = dto.dreamLaunchDispatchOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data, facts = await loadDreamLaunchDispatchFacts(tx, principal.canonical_user_id, input);
  const { store, source, inspected, run, now, context, sourceFields, projectSlug } = facts;
  const receipts = new ReceiptRepository(tx, serviceClientId, principal.subject);
  if (operation === "dream-launch-dispatch.finish") {
    const finish = dto.dreamLaunchDispatchFinishInputDto.parse(input);
    return receipts.execute(operation, requestId, finish, dto.dreamLaunchDispatchFinishOutputDto, async () => {
      if (inspected.dispatch_status !== "dispatching" || inspected.claim_id !== finish.claim_id) return { finished: false, ...sourceFields };
      const overlay = await overlayDreamLaunchFinish(source.metadata, finish.accepted);
      await store.finish(source.message_id, source.thread_id, overlay.metadata_json);
      return { finished: true, ...sourceFields };
    }, source.thread_id, null, run.workflow_run_id);
  }
  const claim = dto.dreamLaunchDispatchClaimInputDto.parse(input);
  const result = await receipts.execute(operation, requestId, claim, dto.dreamLaunchDispatchClaimOutputDto, async () => {
    if (inspected.dispatch_status === "dispatched" || inspected.claim_fresh) return { claimed: false as const, ...sourceFields };
    const claimId = `dlc_${randomUUID().replaceAll("-", "")}`;
    const overlay = await overlayDreamLaunchClaim(source.metadata, { context, claim_id: claimId, now, project_slug: projectSlug, instruction_text: claim.instruction_text });
    await store.claim(source.message_id, source.thread_id, overlay.parts_json, overlay.metadata_json);
    return { claimed: true as const, ...sourceFields, claim_id: claimId, context, parts_json: overlay.parts_json, metadata_json: overlay.runtime_metadata_json };
  }, source.thread_id, null, run.workflow_run_id);
  await validateDreamLaunchClaimResult(result, facts, claim.instruction_text);
  return result;
}
