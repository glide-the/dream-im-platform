// [Input] One persisted message ID and authenticated canonical Run/Thread scope in a caller-owned UOW.
// [Output] Locked durable confirmation facts and current Run/workspace ownership.
// [Pos] Fixed production ORM boundary; no control message or claim is mutated by this guard.
// [Sync] 2026-09-15: lock the existing message after the caller locks its owned Thread.
import { and, eq, sql } from "drizzle-orm";
import { chat_message as message, chat_thread as thread, workflow_runs as run } from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspace } from "@ink-memory/db/schema";
import type { DataTransaction } from "./database";

export class ConfirmationGuardRepository {
  constructor(private readonly tx: DataTransaction) {}
  async message(messageId: string) {
    const rows = await this.tx.select({ id: message.id, thread_id: message.thread_id, role: message.role, parts_json: message.parts, metadata_json: message.metadata, user_id: sql<string>`${thread.user_id}::text` }).from(message).innerJoin(thread, eq(thread.id, message.thread_id)).where(eq(message.id, messageId)).limit(1).for("update", { of: message });
    return rows[0] ?? null;
  }
  async ownsRun(canonicalUserId: string, threadId: string, runId: string) {
    const rows = await this.tx.select({ id: run.id }).from(run).innerJoin(workspace, eq(workspace.id, run.workspace_id)).where(and(eq(run.id, runId), eq(run.created_by, canonicalUserId), eq(run.source_voice_thread_id, threadId), eq(workspace.owner_id, sql`${canonicalUserId}::bigint`))).limit(1);
    return rows.length === 1;
  }
}
