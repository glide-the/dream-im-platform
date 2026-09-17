// [Input] Verified write actor, closed failed-Run request, mandatory fixed pure codec and caller UOW.
// [Output] Independent envelope completion/receipt/audit preserving the prior committed Run failure.
// [Pos] Registered77 domain composition; existing Run.fail remains the lifecycle authority.
// [Sync] 2026-09-15: preserve current owner/grant/source validators at original recovery registration.
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { ChatThreadActor } from "./chatThreadService";
import { dreamLaunchSourceSchemaRequirements } from "./dreamLaunchSourceService";
import { dreamLaunchFailureEnvelopeInputDto, dreamLaunchFailureEnvelopeOutputDto } from "./dreamLaunchFailureDto";
import { DreamLaunchFailureRepository } from "./dreamLaunchFailureRepository";
import { ReceiptRepository } from "./receipts";
import { projectStoredWorkflowRun, projectWorkflowTimestamp } from "./workflowRunService";
export const dreamLaunchFailureSchemaRequirements = dreamLaunchSourceSchemaRequirements;
export type DreamLaunchFailureOverlay = (metadata: string | null, errorCode: string) => Promise<{ metadata_json: string }>;
export async function loadDreamLaunchFailureFacts(rawInput: unknown, actor: ChatThreadActor & { runScope?: string | null }, tx: DataTransaction) {
  const parsed = dreamLaunchFailureEnvelopeInputDto.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const input = parsed.data, principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if ((actor.runScope ?? null) !== null && actor.runScope !== input.workflow_run_id) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  const store = new DreamLaunchFailureRepository(tx), raw = await store.ownedRun(principal.canonical_user_id, input);
  if (!raw) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  const { id, ...fields } = raw, run = projectStoredWorkflowRun({ ...fields, workflow_run_id: id });
  if (run.created_by !== principal.canonical_user_id || run.workspace_id !== input.workspace_id || run.workflow_run_id !== input.workflow_run_id)
    throw new AuthBoundaryError("DREAM_LAUNCH_FAILURE_PERMISSION_DENIED", 403);
  if (actor.threadScope !== null && (actor.threadScope !== raw.source_voice_thread_id || actor.runScope !== run.workflow_run_id))
    throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  if (run.status !== "failed") throw new AuthBoundaryError("DREAM_LAUNCH_FAILURE_NOT_READY", 409);
  const sourceFields = { workflow_run_id: run.workflow_run_id, thread_id: raw.source_voice_thread_id, message_id: raw.source_message_id, error_code: input.error_code };
  const source = raw.source_message_id !== null && raw.source_voice_thread_id !== null ? await store.source(raw.source_message_id, raw.source_voice_thread_id) : null;
  if (source && (source.user_id !== principal.canonical_user_id || source.role !== "user" || source.thread_id !== raw.source_voice_thread_id ||
    source.message_id !== raw.source_message_id || projectWorkflowTimestamp(source.created_at) !== run.source_message_time))
    throw new AuthBoundaryError("DREAM_LAUNCH_FAILURE_PERMISSION_DENIED", 403);
  return { input, principal, store, run, source, sourceFields };
}
type DreamLaunchFailureFacts = Awaited<ReturnType<typeof loadDreamLaunchFailureFacts>>;
export function validateDreamLaunchFailureResult(result: z.output<typeof dreamLaunchFailureEnvelopeOutputDto>, facts: DreamLaunchFailureFacts) {
  const expected = facts.sourceFields;
  if (result.workflow_run_id !== expected.workflow_run_id || result.thread_id !== expected.thread_id || result.message_id !== expected.message_id || result.error_code !== expected.error_code)
    throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
  if (result.updated && !facts.source) throw new AuthBoundaryError("DREAM_LAUNCH_FAILURE_SOURCE_UNAVAILABLE");
  return result;
}
export async function persistDreamLaunchFailureEnvelope(rawInput: unknown, actor: ChatThreadActor & { runScope?: string | null }, serviceId: string,
  requestId: string, tx: DataTransaction, overlay: DreamLaunchFailureOverlay) {
  const facts = await loadDreamLaunchFailureFacts(rawInput, actor, tx);
  const { input, principal, store, run, source, sourceFields } = facts;
  const result = await new ReceiptRepository(tx, serviceId, principal.subject).execute("dream-launch-failure.envelope", requestId, input,
    dreamLaunchFailureEnvelopeOutputDto, async () => {
      if (!source) return { updated: false, ...sourceFields };
      const encoded = z.strictObject({ metadata_json: z.string() }).parse(await overlay(source.metadata, input.error_code));
      await store.update(source.message_id, source.thread_id, encoded.metadata_json);
      return { updated: true, ...sourceFields };
    }, sourceFields.thread_id, null, run.workflow_run_id);
  return validateDreamLaunchFailureResult(result, facts);
}
