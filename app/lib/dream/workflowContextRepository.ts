// [Input] Canonical owner and Thread inside the existing Admin domain transaction.
// [Output] Owner-scoped Thread and complete indexed retry/binding/source facts, including raw JSON.
// [Pos] Fixed Workflow ORM queries; no caller SQL, selector or independent connection.
// [Sync] 2026-09-14: retain decimal owners and exact PG timestamp/raw metadata provenance.
import { and, eq, sql } from "drizzle-orm";
import { chat_thread as thread, chat_message as message, workflow_runs as run, deck_plugin_bindings as binding } from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspace } from "@ink-memory/db/schema";
import type { DataTransaction } from "./database";
import { decimalIdDto } from "../auth/dto";

export class WorkflowContextRepository {
  constructor(private readonly tx: DataTransaction) {}
  async thread(canonicalUserId: string, threadId: string) {
    decimalIdDto.parse(canonicalUserId);
    const rows = await this.tx.select({ id: thread.id, user_id: sql<string>`${thread.user_id}::text`, deck_id: thread.deck_id, voice_id: thread.voice_id }).from(thread).where(and(eq(thread.id, threadId), eq(thread.user_id, sql`${canonicalUserId}::bigint`))).limit(1);
    return rows[0] ?? null;
  }
  async attempts(threadId: string, capacity: number) {
    return this.tx.select({
      workflow_run_id: run.id, retry_of_run_id: run.retry_of_run_id, status: run.status,
      workspace_id: run.workspace_id, created_by: sql<string>`${run.created_by}::text`, source_voice_thread_id: run.source_voice_thread_id,
      source_message_id: run.source_message_id, source_message_time: sql<string | null>`${run.source_message_time}::text`,
      source_message_thread_id: message.thread_id, source_message_role: message.role, source_message_metadata: message.metadata,
      input_hash: run.input_hash, workflow_definition_ref: run.workflow_definition_ref, deck_plugin_manifest_hash: run.deck_plugin_manifest_hash,
      deck_plugin_id: run.deck_plugin_id, deck_plugin_version: run.deck_plugin_version, deck_plugin_binding_id: run.deck_plugin_binding_id,
      binding_revision: run.binding_revision, deck_runtime_snapshot_id: run.deck_runtime_snapshot_id, runtime_plugin_lock_id: run.runtime_plugin_lock_id,
      workspace_owner_id: sql<string | null>`${workspace.owner_id}::text`, binding_deck_id: binding.deck_id, binding_workspace_id: binding.workspace_id,
      binding_deck_plugin_id: binding.deck_plugin_id, binding_deck_plugin_version: binding.deck_plugin_version, binding_revision_actual: binding.binding_revision,
    }).from(run).leftJoin(workspace, eq(workspace.id, run.workspace_id)).leftJoin(binding, eq(binding.deck_plugin_binding_id, run.deck_plugin_binding_id)).leftJoin(message, eq(message.id, run.source_message_id)).where(eq(run.source_voice_thread_id, threadId)).limit(capacity + 1);
  }
}
