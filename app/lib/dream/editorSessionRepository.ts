// [Input] Admin data UOW and verified canonical owner with named Session parameters.
// [Output] Fixed ORM queries, owned last-write save/replace and microsecond timestamp strings.
// [Pos] Sole PostgreSQL Editor/Session repository; Runtime receives no database credential.
// [Sync] 2026-09-14: deny cross-owner upsert and preserve SQL null update rules.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { chat_thread, user_sessions } from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "./database";
import type { EditorStateDto } from "./editorSessionDto";
const projection = { id: user_sessions.id, name: user_sessions.name, stateJson: user_sessions.editor_state_json, labelsJson: user_sessions.labels, createdAt: sql<string | null>`${user_sessions.created_at}::text`, updatedAt: sql<string | null>`${user_sessions.updated_at}::text` };
export class EditorSessionRepository {
  constructor(private readonly tx: DataTransaction, private readonly canonicalUserId: string) {}
  private owner() { return eq(user_sessions.user_id, sql`${this.canonicalUserId}::bigint`); }
  async current(sessionId: string) {
    const rows = await this.tx.select(projection).from(user_sessions).where(and(this.owner(), eq(user_sessions.id, sessionId))).limit(1);
    return rows[0] ?? null;
  }
  async ownsWritingThread(threadId: string) {
    const rows = await this.tx.select({ id: chat_thread.id }).from(chat_thread).where(and(eq(chat_thread.id, threadId), eq(chat_thread.user_id, sql`${this.canonicalUserId}::bigint`))).for("share").limit(1);
    return !!rows[0];
  }
  async replace(sessionId: string, state: EditorStateDto) {
    const rows = await this.tx.update(user_sessions).set({ editor_state_json: JSON.stringify(state), updated_at: sql`CURRENT_TIMESTAMP` }).where(and(this.owner(), eq(user_sessions.id, sessionId))).returning({ updatedAt: sql<string>`${user_sessions.updated_at}::text` });
    return rows[0] ?? null;
  }
  async save(input: { session_id: string; editor_state: EditorStateDto; name: string | null; labels: string[] | null; created_at: string | null }) {
    const stateJson = JSON.stringify(input.editor_state), labelsJson = input.labels === null ? null : JSON.stringify(input.labels);
    const rows = await this.tx.insert(user_sessions).values({ id: input.session_id, user_id: sql`${this.canonicalUserId}::bigint`, name: input.name, editor_state_json: stateJson, labels: labelsJson, created_at: input.created_at ?? sql`CURRENT_TIMESTAMP`, updated_at: sql`CURRENT_TIMESTAMP` }).onConflictDoUpdate({ target: user_sessions.id, set: { editor_state_json: stateJson, name: sql`COALESCE(${input.name}, ${user_sessions.name})`, labels: sql`COALESCE(${labelsJson}, ${user_sessions.labels})`, updated_at: sql`CURRENT_TIMESTAMP` }, setWhere: this.owner() }).returning(projection);
    return rows[0] ?? null;
  }
  async batch(sessionIds: string[]) {
    if (!sessionIds.length) return [];
    return this.tx.select(projection).from(user_sessions).where(and(this.owner(), inArray(user_sessions.id, sessionIds)));
  }
  async list(startDate: string | null = null, endDate: string | null = null) {
    return this.tx.select(projection).from(user_sessions).where(and(this.owner(), sql`(${startDate}::date IS NULL OR date(COALESCE(${user_sessions.created_at}, ${user_sessions.updated_at})) >= ${startDate}::date)`, sql`(${endDate}::date IS NULL OR date(COALESCE(${user_sessions.created_at}, ${user_sessions.updated_at})) <= ${endDate}::date)`)).orderBy(desc(user_sessions.updated_at));
  }
  async delete(sessionId: string) { await this.tx.delete(user_sessions).where(and(this.owner(), eq(user_sessions.id, sessionId))); }
}
export type EditorSessionRow = NonNullable<Awaited<ReturnType<EditorSessionRepository["current"]>>>;
