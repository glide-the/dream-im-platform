// [Input] Existing typed Admin transaction and verified canonical actor.
// [Output] Current enabled Deck/workspace scope, locked deterministic source and atomic backing inserts.
// [Pos] Launch source repository; no pool, transaction commit, Runtime or user-authored metadata.
// [Sync] 2026-09-15: preserve original hidden source transaction and exact PostgreSQL clock text.
import { and, eq, sql } from "drizzle-orm";
import { chat_message as message, chat_thread as thread, decks } from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspace } from "@ink-memory/db/schema";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { operationRequestKeyDigest } from "./receipts";

export class DreamLaunchSourceRepository {
  readonly actor: string;
  constructor(private readonly tx: DataTransaction, actor: string) { this.actor = decimalIdDto.parse(actor); }
  async lockSource(workspaceId: string, key: string) {
    const digest = operationRequestKeyDigest("dream-launch-source", this.actor, workspaceId, key);
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${digest}, 0))`);
  }
  async requireScope(workspaceId: string, deckId: string) {
    const rows = await this.tx.select({ id: decks.id }).from(decks).innerJoin(workspace,
      and(eq(workspace.id, workspaceId), eq(workspace.owner_id, decks.owner_id)))
      .where(and(eq(decks.id, deckId), eq(decks.owner_id, sql`${this.actor}::bigint`), eq(decks.enabled, true)))
      .limit(1).for("share", { of: [decks, workspace] });
    if (!rows[0]) throw new AuthBoundaryError("DECK_ACCESS_DENIED", 404);
  }
  async existingMessage(messageId: string) {
    return (await this.tx.select({ thread_id: message.thread_id, role: message.role, metadata: message.metadata,
      created_at: sql<string>`${message.created_at}::text`, user_id: sql<string>`${thread.user_id}::text`, deck_id: thread.deck_id, voice_id: thread.voice_id })
      .from(message).innerJoin(thread, eq(thread.id, message.thread_id)).where(eq(message.id, messageId))
      .limit(1).for("update", { of: [message, thread] }))[0] ?? null;
  }
  async existingThread(threadId: string) {
    return (await this.tx.select({ user_id: sql<string>`${thread.user_id}::text`, deck_id: thread.deck_id, voice_id: thread.voice_id })
      .from(thread).where(eq(thread.id, threadId)).limit(1).for("update"))[0] ?? null;
  }
  async clock() {
    const result = await this.tx.execute(sql`SELECT clock_timestamp()::text AS now`);
    const now = (result.rows[0] as { now: string } | undefined)?.now;
    if (!now) throw new AuthBoundaryError("DREAM_LAUNCH_SOURCE_UNAVAILABLE", 503);
    return now;
  }
  async insertThread(id: string, title: string, deckId: string, agentId: string | null) {
    await this.tx.insert(thread).values({ id, user_id: sql`${this.actor}::bigint`, title, deck_id: deckId, voice_id: agentId });
  }
  async insertMessage(id: string, threadId: string, parts: string, metadata: string, time: string) {
    await this.tx.insert(message).values({ id, thread_id: threadId, role: "user", parts, metadata, created_at: time });
    await this.tx.update(thread).set({ updated_at: time }).where(and(eq(thread.id, threadId), eq(thread.user_id, sql`${this.actor}::bigint`)));
  }
}
export type DreamLaunchExistingMessage = NonNullable<Awaited<ReturnType<DreamLaunchSourceRepository["existingMessage"]>>>;
