// [Input] Canonical owner, owned workspace and a business Run identifier inside the Admin data UOW.
// [Output] Full stored Run projection and ordered history with raw PostgreSQL timestamp text.
// [Pos] Fixed Workflow ORM repository; no independent pool, DDL or caller SQL.
// [Sync] 2026-09-15: preserve original actor/workspace Run scope and current workspace ownership.
import { and, asc, eq, sql } from "drizzle-orm";
import { workflow_runs as run, workflow_run_transitions as transition } from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspace } from "@ink-memory/db/schema";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { WorkflowRunLookup } from "./workflowRunDto";

export class WorkflowRunRepository {
  constructor(private readonly tx: DataTransaction) {}
  async read(canonicalUserId: string, input: WorkflowRunLookup, lock = false) {
    decimalIdDto.parse(canonicalUserId);
    const query = this.tx.select({
      workflow_run_id: run.id, deck_plugin_id: run.deck_plugin_id, deck_plugin_version: run.deck_plugin_version,
      workflow_definition_ref: run.workflow_definition_ref, deck_runtime_snapshot_id: run.deck_runtime_snapshot_id,
      status: run.status, failed_step: run.failed_step, error_code: run.error_code, retry_of_run_id: run.retry_of_run_id,
      deck_plugin_manifest_hash: run.deck_plugin_manifest_hash, deck_plugin_binding_id: run.deck_plugin_binding_id,
      binding_revision: run.binding_revision, runtime_plugin_lock_id: run.runtime_plugin_lock_id,
      runtime_load_receipt_id: run.runtime_load_receipt_id, workflow_preflight_id: run.workflow_preflight_id,
      agent_session_id: run.agent_session_id, source_voice_thread_id: run.source_voice_thread_id,
      source_message_id: run.source_message_id, source_message_time: sql<string | null>`${run.source_message_time}::text`,
      workspace_id: run.workspace_id, idempotency_key: run.idempotency_key, input_hash: run.input_hash,
      semantic_fingerprint: run.semantic_fingerprint, status_version: run.status_version, created_by: run.created_by,
      created_at: sql<string>`${run.created_at}::text`, started_at: sql<string | null>`${run.started_at}::text`,
      completed_at: sql<string | null>`${run.completed_at}::text`,
    }).from(run).innerJoin(workspace, eq(workspace.id, run.workspace_id)).where(and(
      eq(run.id, input.workflow_run_id), eq(run.workspace_id, input.workspace_id), eq(run.created_by, canonicalUserId),
      eq(workspace.owner_id, sql`${canonicalUserId}::bigint`),
    )).limit(1);
    const rows = lock ? await query.for("update", { of: [run, workspace] }) : await query;
    return rows[0] ?? null;
  }
  async history(runId: string) {
    return this.tx.select({
      transition_id: transition.id, workflow_run_id: transition.workflow_run_id, transition_seq: transition.transition_seq,
      from_status: transition.from_status, to_status: transition.to_status, actor_id: transition.actor_id,
      reason_code: transition.reason_code, failed_step: transition.failed_step, error_code: transition.error_code,
      occurred_at: sql<string>`${transition.occurred_at}::text`,
    }).from(transition).where(eq(transition.workflow_run_id, runId)).orderBy(asc(transition.transition_seq));
  }
}
