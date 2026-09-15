// [Input] Verified canonical actor and closed Run start/fail/cancel facts in the existing Admin UOW.
// [Output] Original lifecycle replay or atomic Session/status/history mutation; no client readiness claims.
// [Pos] Production Workflow command composition; Runtime execution and FS remain with Dream.
// [Sync] 2026-09-15: derive readiness/placement/lock hash from persisted facts and keep terminal replay bounded.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { ChatThreadActor } from "./chatThreadService";
import { WorkflowRunRepository } from "./workflowRunRepository";
import { WorkflowRunCommandRepository, workflowLocalPlacementSchemaRequirement } from "./workflowRunCommandRepository";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { identitySchemaRequirement } from "./schemaRequirements";
import { projectStoredWorkflowRun, projectWorkflowTimestamp } from "./workflowRunService";
import { canonicalBusinessJson } from "./deckContentCanonical";
import { workflowRunReadOutputDto, workflowTimeDto, type WorkflowRun } from "./workflowRunDto";
import * as dto from "./workflowRunCommandDto";
export function workflowRunCommandSchemaRequirements(name: dto.WorkflowRunCommandOperation) { return [identitySchemaRequirement, dreamUnifiedSchemaRequirement, ...(name === "workflow-run.start" ? [workflowLocalPlacementSchemaRequirement] : [])]; }

const nonterminalStatuses = new Set(["preflight", "queued", "running", "output_validating", "pending_review", "confirmed"]);
const placementFields = ["runtime_environment_id", "runtime_pool_id", "distribution_mode", "runtime_node_id", "artifact_set_hash", "policy_revision", "deployment_tier"] as const;
const placementDto = z.strictObject({ runtime_environment_id: z.string().min(1), runtime_pool_id: z.string().min(1), distribution_mode: z.literal("local_persistent"),
  runtime_node_id: z.string().min(1), artifact_set_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/), policy_revision: z.string().min(1), deployment_tier: z.literal("local") });
const unavailableReceipt = () => { throw new AuthBoundaryError("RUNTIME_LOAD_RECEIPT_NOT_READY", 409); };
const unavailableSession = () => { throw new AuthBoundaryError("AGENT_SESSION_NOT_READY", 409); };
async function requireStartBindings(run: WorkflowRun, input: dto.WorkflowRunStartInput, store: WorkflowRunCommandRepository) {
  const readiness = await store.readiness(input.runtime_load_receipt_id);
  if (!readiness || readiness.receipt_id !== input.runtime_load_receipt_id || readiness.workflow_run_id !== run.workflow_run_id || readiness.runtime_plugin_lock_id !== run.runtime_plugin_lock_id || readiness.required_entries_ready !== 1 || run.runtime_load_receipt_id !== null || run.agent_session_id !== null) return unavailableReceipt();
  const placement = placementDto.safeParse(Object.fromEntries(placementFields.map(field => [field, readiness[field]])));
  if (!placement.success || readiness.runtime_pool_id !== readiness.runtime_environment_id) return unavailableReceipt();
  const lockJson = await store.lockJson(run.runtime_plugin_lock_id);
  if (lockJson === null) return unavailableReceipt();
  if ((await canonicalBusinessJson(lockJson)).content_hash !== readiness.runtime_plugin_lock_digest) return unavailableReceipt();
  const session = await store.session(input.agent_session_id);
  if (!session || session.status !== "creating" || session.workflow_run_id !== run.workflow_run_id || session.runtime_load_receipt_id !== readiness.receipt_id || session.runtime_plugin_lock_id !== run.runtime_plugin_lock_id || session.runtime_plugin_lock_digest !== readiness.runtime_plugin_lock_digest || placementFields.some(field => session[field] !== readiness[field])) return unavailableSession();
  return readiness;
}
export async function prepareWorkflowRunCommand(operation: dto.WorkflowRunCommandOperation, rawInput: unknown, actor: ChatThreadActor, tx: DataTransaction) {
  const contract = dto.workflowRunCommandOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const input = parsed.data;
  const runs = new WorkflowRunRepository(tx);
  const current = projectStoredWorkflowRun(await runs.read(principal.canonical_user_id, input, true));
  if (current.workflow_run_id !== input.workflow_run_id || current.workspace_id !== input.workspace_id || current.created_by !== principal.canonical_user_id) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  if (actor.threadScope !== null && current.source_voice_thread_id !== actor.threadScope) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
  const action = async () => {
    const target = operation === "workflow-run.start" ? "running" : operation === "workflow-run.fail" ? "failed" : "cancelled";
    if (current.status === target) {
      if (target === "running") {
        const start = dto.workflowRunStartInputDto.parse(input);
        if (current.runtime_load_receipt_id !== start.runtime_load_receipt_id || current.agent_session_id !== start.agent_session_id) return unavailableSession();
      }
      return workflowRunReadOutputDto.parse({ run: current });
    }
    if (!nonterminalStatuses.has(current.status) || (target === "running" && current.status !== "queued")) throw new AuthBoundaryError("ILLEGAL_RUN_TRANSITION", 409);
    const store = new WorkflowRunCommandRepository(tx);
    const details = { runtime_load_receipt_id: current.runtime_load_receipt_id, agent_session_id: current.agent_session_id, failed_step: null as string | null, error_code: null as string | null };
    let startInput: dto.WorkflowRunStartInput | null = null;
    if (target === "running") {
      startInput = dto.workflowRunStartInputDto.parse(input);
      const readiness = await requireStartBindings(current, startInput, store);
      details.runtime_load_receipt_id = readiness.receipt_id; details.agent_session_id = startInput.agent_session_id;
    } else if (target === "failed") {
      const failure = dto.workflowRunFailInputDto.parse(input); details.failed_step = failure.failed_step; details.error_code = failure.error_code;
    }
    const now = workflowTimeDto.parse(projectWorkflowTimestamp(await store.clock()));
    if (startInput && !await store.activateSession(startInput.agent_session_id, now)) return unavailableSession();
    if (!await store.advance(current, target, now, details)) throw new AuthBoundaryError("ILLEGAL_RUN_TRANSITION", 409);
    await store.append({ id: `wrt_${randomUUID().replaceAll("-", "")}`, workflow_run_id: current.workflow_run_id,
      transition_seq: current.status_version + 1, from_status: current.status, to_status: target,
      actor_id: principal.canonical_user_id, reason_code: input.reason_code, failed_step: details.failed_step, error_code: details.error_code, occurred_at: now });
    return workflowRunReadOutputDto.parse({ run: projectStoredWorkflowRun(await runs.read(principal.canonical_user_id, input)) });
  };
  return { action, threadScope: current.source_voice_thread_id, runScope: current.workflow_run_id };
}
