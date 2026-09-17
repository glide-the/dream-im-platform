// [Input] Canonical actor and one validated guidance identity inside the caller-owned Admin UOW.
// [Output] Locked owned Run/Thread scope and immutable Drizzle message insert or exact replay facts.
// [Pos] Registry115 typed Repository; no caller SQL, table, actor, Workspace, Thread or transaction selector.
// [Sync] 2026-09-15: move guidance authorization, idempotency and persistence into Admin.
import { and, eq, sql } from "drizzle-orm";
import { storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import { chat_message as messages, chat_thread as threads, workflow_runs as runs } from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";

export class StoryWorkspaceGuidanceRepository {
  private readonly actor: string;

  constructor(private readonly tx: DataTransaction, actor: string) {
    this.actor = decimalIdDto.parse(actor);
  }

  async ownedRun(runId: string) {
    return (await this.tx.select({
      workspace_id: runs.workspace_id,
      status: runs.status,
      source_voice_thread_id: runs.source_voice_thread_id,
    }).from(runs).innerJoin(workspaces, eq(workspaces.id, runs.workspace_id)).where(and(
      eq(runs.id, runId),
      eq(runs.created_by, this.actor),
      eq(workspaces.owner_id, sql`${this.actor}::bigint`),
    )).limit(1).for("update"))[0] ?? null;
  }

  async ownsThread(threadId: string) {
    return (await this.tx.select({ id: threads.id }).from(threads).where(and(
      eq(threads.id, threadId),
      eq(threads.user_id, sql`${this.actor}::bigint`),
    )).limit(1).for("update"))[0] !== undefined;
  }

  async lockMessageIdentity(messageId: string) {
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${messageId}, 0))`);
  }

  async message(messageId: string) {
    return (await this.tx.select({
      id: messages.id,
      thread_id: messages.thread_id,
      role: messages.role,
      parts: messages.parts,
      metadata: messages.metadata,
    }).from(messages).where(eq(messages.id, messageId)).limit(1).for("update"))[0] ?? null;
  }

  async insertMessage(messageId: string, threadId: string, parts: string, metadata: string) {
    const inserted = await this.tx.insert(messages).values({
      id: messageId,
      thread_id: threadId,
      role: "user",
      parts,
      metadata,
      history_final_text: null,
      history_process_available: false,
      history_projection_version: null,
    }).onConflictDoNothing({ target: messages.id }).returning({ id: messages.id });
    if (inserted.length !== 1) return false;
    await this.tx.update(threads).set({ updated_at: sql`CURRENT_TIMESTAMP` }).where(and(
      eq(threads.id, threadId),
      eq(threads.user_id, sql`${this.actor}::bigint`),
    ));
    return true;
  }
}
