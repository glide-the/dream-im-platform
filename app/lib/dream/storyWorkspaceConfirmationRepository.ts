// [Input] Canonical owner or exact durable claim identity inside one Admin UOW.
// [Output] Typed Drizzle Run/Thread/message locks, CAS mutation, clock and lifecycle events.
// [Pos] Registry120 persistence adapter; callers cannot select SQL, tables, columns or actors.
// [Sync] 2026-09-16: move the full Dream confirmation database state machine into Admin.
import { and, asc, eq, like, sql } from "drizzle-orm";
import { storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import { chat_message as messages, chat_thread as threads, workflow_runs as runs,
  workflow_run_transitions as transitions } from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "./database";

const actorBigint = (actor: string) => sql`${actor}::bigint`;
const messageProjection = {
  id: messages.id,
  thread_id: messages.thread_id,
  role: messages.role,
  parts_json: messages.parts,
  metadata_json: messages.metadata,
  created_at: messages.created_at,
  actor_id: sql<string>`${threads.user_id}::text`,
};

export class StoryWorkspaceConfirmationRepository {
  constructor(private readonly tx: DataTransaction) {}

  async ownedRun(actor: string, runId: string, lockForUpdate = true) {
    const query = this.tx.select({
      workflow_run_id: runs.id,
      workspace_id: runs.workspace_id,
      status: runs.status,
      status_version: runs.status_version,
      source_voice_thread_id: runs.source_voice_thread_id,
    }).from(runs)
      .innerJoin(workspaces, eq(workspaces.id, runs.workspace_id))
      .innerJoin(threads, eq(threads.id, runs.source_voice_thread_id))
      .where(and(eq(runs.id, runId), eq(runs.created_by, actor),
        eq(workspaces.owner_id, actorBigint(actor)), eq(threads.user_id, actorBigint(actor))))
      .limit(1);
    const rows = lockForUpdate
      ? await query.for("update", { of: [runs, workspaces, threads] })
      : await query;
    return rows[0] ?? null;
  }

  async scopedRun(actor: string, runId: string, threadId: string) {
    const rows = await this.tx.select({
      workflow_run_id: runs.id,
      status: runs.status,
      status_version: runs.status_version,
      source_voice_thread_id: runs.source_voice_thread_id,
    }).from(runs)
      .innerJoin(workspaces, eq(workspaces.id, runs.workspace_id))
      .innerJoin(threads, eq(threads.id, runs.source_voice_thread_id))
      .where(and(eq(runs.id, runId), eq(runs.created_by, actor), eq(runs.source_voice_thread_id, threadId),
        eq(workspaces.owner_id, actorBigint(actor)), eq(threads.user_id, actorBigint(actor))))
      .limit(1).for("update", { of: [runs, workspaces, threads] });
    return rows[0] ?? null;
  }

  async lockMessageIdentity(messageId: string) {
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${messageId}, 0))`);
  }

  async message(messageId: string) {
    const rows = await this.tx.select(messageProjection).from(messages)
      .innerJoin(threads, eq(threads.id, messages.thread_id))
      .where(eq(messages.id, messageId)).limit(1).for("update", { of: messages });
    return rows[0] ?? null;
  }

  async threadConfirmationRows(threadId: string) {
    return this.tx.select(messageProjection).from(messages)
      .innerJoin(threads, eq(threads.id, messages.thread_id))
      .where(and(eq(messages.thread_id, threadId), eq(messages.role, "user"), like(messages.id, "dream_confirm_%")))
      .orderBy(asc(messages.created_at), asc(messages.id));
  }

  async pendingCandidates(targetMessageId: string | null) {
    const predicate = targetMessageId === null
      ? and(eq(messages.role, "user"), like(messages.id, "dream_confirm_%"))
      : and(eq(messages.id, targetMessageId), eq(messages.role, "user"));
    return this.tx.select(messageProjection).from(messages)
      .innerJoin(threads, eq(threads.id, messages.thread_id))
      .where(predicate).orderBy(asc(messages.created_at), asc(messages.id));
  }

  async insertMessage(messageId: string, threadId: string, partsJson: string, metadataJson: string, actor: string) {
    const inserted = await this.tx.insert(messages).values({
      id: messageId, thread_id: threadId, role: "user", parts: partsJson, metadata: metadataJson,
      history_final_text: null, history_process_available: false, history_projection_version: null,
    }).onConflictDoNothing({ target: messages.id }).returning({ id: messages.id });
    if (inserted.length !== 1) return false;
    const touched = await this.tx.update(threads).set({ updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(threads.id, threadId), eq(threads.user_id, actorBigint(actor))))
      .returning({ id: threads.id });
    return touched.length === 1;
  }

  async compareAndSetMessage(messageId: string, oldParts: string, oldMetadata: string, partsJson: string, metadataJson: string) {
    const rows = await this.tx.update(messages).set({ parts: partsJson, metadata: metadataJson })
      .where(and(eq(messages.id, messageId), eq(messages.parts, oldParts), eq(messages.metadata, oldMetadata)))
      .returning({ id: messages.id });
    return rows.length === 1;
  }

  async compareAndSetMetadata(messageId: string, oldMetadata: string, metadataJson: string) {
    const rows = await this.tx.update(messages).set({ metadata: metadataJson })
      .where(and(eq(messages.id, messageId), eq(messages.metadata, oldMetadata)))
      .returning({ id: messages.id });
    return rows.length === 1;
  }

  async clockSeconds() {
    const result = await this.tx.execute(sql`SELECT extract(epoch FROM clock_timestamp())::double precision AS value`);
    return Number(result.rows[0]?.value);
  }

  async clockText() {
    const result = await this.tx.execute(sql`SELECT clock_timestamp()::text AS value`);
    return String(result.rows[0]?.value ?? "");
  }

  async advanceRun(current: { workflow_run_id: string; status: string; status_version: number }, target: string,
    actor: string, reasonCode: string, transitionId: string, occurredAt: string) {
    const updated = await this.tx.update(runs).set({ status: target, status_version: current.status_version + 1 })
      .where(and(eq(runs.id, current.workflow_run_id), eq(runs.status, current.status),
        eq(runs.status_version, current.status_version))).returning({
        workflow_run_id: runs.id, status: runs.status, status_version: runs.status_version,
        source_voice_thread_id: runs.source_voice_thread_id,
      });
    if (updated.length !== 1) return null;
    await this.tx.insert(transitions).values({
      id: transitionId,
      workflow_run_id: current.workflow_run_id,
      transition_seq: current.status_version + 1,
      from_status: current.status,
      to_status: target,
      actor_id: actor,
      reason_code: reasonCode,
      failed_step: null,
      error_code: null,
      occurred_at: occurredAt,
    });
    return updated[0];
  }
}

export type StoryWorkspaceConfirmationMessageRow = Awaited<ReturnType<StoryWorkspaceConfirmationRepository["message"]>>;
