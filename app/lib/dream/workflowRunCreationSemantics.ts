// [Input] Raw stored Preflight/release/lock fields and owned source/retry provenance.
// [Output] Original frozen source and semantic fingerprint, intentionally excluding token and PF identifiers.
// [Pos] Pure business composition reusing the fixed canonical codec; no database or signing endpoint.
// [Sync] 2026-09-15: keep raw semantic strings separate from Pydantic display projections.
import type { WorkflowRunCreationContext } from "./workflowRunCreationRepository";
import type { WorkflowRun } from "./workflowRunDto";
import { canonicalBusinessJson } from "./deckContentCanonical";
import { projectWorkflowTimestamp } from "./workflowRunService";
import { AuthBoundaryError } from "../auth/config";

export type WorkflowRunSource = { source_voice_thread_id: string | null; source_message_id: string | null; source_message_time: string | null };
export function workflowRunSourceFacts(value: Pick<WorkflowRun, "source_voice_thread_id" | "source_message_id" | "source_message_time">): WorkflowRunSource {
  const { source_voice_thread_id, source_message_id, source_message_time } = value;
  // strictObject requires these keys at runtime; retain that guarantee even
  // where the repository's non-strict TypeScript configuration infers optional.
  if ([source_voice_thread_id, source_message_id, source_message_time].some(field => field !== null && typeof field !== "string")) throw new AuthBoundaryError("WORKFLOW_RUN_DATA_INVALID");
  return { source_voice_thread_id, source_message_id, source_message_time };
}
export function normalizeWorkflowRunSourceTime(value: string | null) {
  // datetime.fromisoformat truncates precision beyond microseconds before the
  // original service serializes UTC. PostgreSQL storage retains six digits.
  return value === null ? null : projectWorkflowTimestamp(value.replace(/(\.\d{6})\d+(?=Z|[+-])/, "$1"));
}
export function frozenRunSourceFromContext(context: WorkflowRunCreationContext, source: WorkflowRunSource) {
  return { deck_plugin_id: context.deck_plugin_id, deck_plugin_version: context.deck_plugin_version,
    workflow_definition_ref: context.workflow_definition_ref, deck_runtime_snapshot_id: context.deck_runtime_snapshot_id,
    deck_plugin_manifest_hash: context.manifest_hash, deck_plugin_binding_id: context.deck_plugin_binding_id,
    binding_revision: context.binding_revision, runtime_plugin_lock_id: context.runtime_plugin_lock_id, input_hash: context.input_hash,
    source_voice_thread_id: source.source_voice_thread_id, source_message_id: source.source_message_id,
    source_message_time: normalizeWorkflowRunSourceTime(source.source_message_time) };
}
export function frozenRunSourceFromRun(run: WorkflowRun) {
  const { deck_plugin_id, deck_plugin_version, workflow_definition_ref, deck_runtime_snapshot_id, deck_plugin_manifest_hash,
    deck_plugin_binding_id, binding_revision, runtime_plugin_lock_id, input_hash, source_voice_thread_id, source_message_id, source_message_time } = run;
  return { deck_plugin_id, deck_plugin_version, workflow_definition_ref, deck_runtime_snapshot_id, deck_plugin_manifest_hash,
    deck_plugin_binding_id, binding_revision, runtime_plugin_lock_id, input_hash, source_voice_thread_id, source_message_id,
    source_message_time: normalizeWorkflowRunSourceTime(source_message_time) };
}
export async function analyzeWorkflowRunCreation(context: WorkflowRunCreationContext, source: WorkflowRunSource, retryOfRunId: string | null) {
  const lock = await canonicalBusinessJson(context.lock_json), frozenSource = frozenRunSourceFromContext(context, source);
  const fingerprint = await canonicalBusinessJson(JSON.stringify({ ...frozenSource, runtime_plugin_lock_digest: lock.content_hash, retry_of_run_id: retryOfRunId }));
  return { frozenSource, fingerprint: fingerprint.content_hash, lockDigest: lock.content_hash };
}
