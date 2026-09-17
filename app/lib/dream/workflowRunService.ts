// [Input] Verified scoped actor and a closed workspace/Run business lookup in the existing UOW.
// [Output] Full validated lifecycle/history; missing ownership and corrupt storage remain distinct.
// [Pos] Workflow Run read orchestration; no arbitrary patch or request-authorized actor.
// [Sync] 2026-09-15: retain original UTC normalization with exact microseconds across PG session time zones.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { ChatThreadActor } from "./chatThreadService";
import { pgTimestampToIso } from "./chatThreadDto";
import { WorkflowRunRepository } from "./workflowRunRepository";
import * as dto from "./workflowRunDto";
export function projectWorkflowTimestamp(raw: string | null) {
  const iso = pgTimestampToIso(raw);
  return iso === null ? null : dto.workflowUtcMicroseconds(iso);
}

export function projectStoredWorkflowRun(raw: Awaited<ReturnType<WorkflowRunRepository["read"]>>) {
  if (!raw) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  try {
    return dto.workflowRunDto.parse({ ...raw, source_message_time: projectWorkflowTimestamp(raw.source_message_time),
      created_at: projectWorkflowTimestamp(raw.created_at), started_at: projectWorkflowTimestamp(raw.started_at), completed_at: projectWorkflowTimestamp(raw.completed_at) });
  } catch { throw new AuthBoundaryError("WORKFLOW_RUN_DATA_INVALID"); }
}
export async function readWorkflowRun(operation: dto.WorkflowRunOperation, rawInput: unknown, actor: ChatThreadActor, tx: DataTransaction) {
  const parsed = dto.workflowRunLookupInputDto.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes("dream:read")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const store = new WorkflowRunRepository(tx);
  const run = projectStoredWorkflowRun(await store.read(principal.canonical_user_id, parsed.data));
  if (run.workflow_run_id !== parsed.data.workflow_run_id || run.workspace_id !== parsed.data.workspace_id || run.created_by !== principal.canonical_user_id) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  if (actor.threadScope !== null && run.source_voice_thread_id !== actor.threadScope) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  if (operation === "workflow-run.read") return dto.workflowRunReadOutputDto.parse({ run });
  if (operation !== "workflow-run.history") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const rows = await store.history(run.workflow_run_id);
  try {
    const transitions = rows.map(row => dto.workflowRunTransitionDto.parse({ ...row, occurred_at: projectWorkflowTimestamp(row.occurred_at) }));
    if (transitions.some(row => row.workflow_run_id !== run.workflow_run_id)) throw new Error("History scope mismatch.");
    return dto.workflowRunHistoryOutputDto.parse({ transitions });
  } catch { throw new AuthBoundaryError("WORKFLOW_RUN_DATA_INVALID"); }
}
