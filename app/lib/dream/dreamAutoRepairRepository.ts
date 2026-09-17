// [Input] Canonical actor and one Thread/message identity in a caller-owned transaction.
// [Output] Locked owned user-message metadata and typed metadata update result.
// [Pos] Registry169 typed Drizzle Repository; no generic CRUD or caller-selected SQL.
// [Sync] 2026-09-16: move auto-repair row locking and persistence into Admin.
import { and, eq, sql } from "drizzle-orm";
import { chat_message as messages, chat_thread as threads } from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";

export class DreamAutoRepairRepository {
  private readonly actor: string;

  constructor(private readonly tx: DataTransaction, actor: string) {
    this.actor = decimalIdDto.parse(actor);
  }

  async lockOwnedUserMessage(threadId: string, messageId: string) {
    return (await this.tx.select({
      id: messages.id,
      thread_id: messages.thread_id,
      role: messages.role,
      metadata: messages.metadata,
    }).from(messages)
      .innerJoin(threads, eq(threads.id, messages.thread_id))
      .where(and(
        eq(messages.id, messageId),
        eq(messages.thread_id, threadId),
        eq(messages.role, "user"),
        eq(threads.user_id, sql`${this.actor}::bigint`),
      )).limit(1).for("update"))[0] ?? null;
  }

  async updateMetadata(threadId: string, messageId: string, metadata: string) {
    return (await this.tx.update(messages).set({ metadata }).where(and(
      eq(messages.id, messageId),
      eq(messages.thread_id, threadId),
      eq(messages.role, "user"),
    )).returning({ id: messages.id })).length === 1;
  }
}
