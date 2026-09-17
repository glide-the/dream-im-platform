// [Input] Existing Admin UOW and server-derived task/section/Thread/subject authority bindings.
// [Output] Locked encrypted authority records with bounded renew and revocation mutations.
// [Pos] Registered Reflections authority Repository; bearer plaintext never enters SQL parameters after creation.
// [Sync] 2026-09-15: persist a single live task-section authority without changing runtime_delegations.
import { and, eq, isNull, sql } from "drizzle-orm";
import { reflectionTaskAuthorities } from "@ink-memory/db/schema/auth";
import { chat_thread, reflection_task, reflection_task_section } from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "./database";

export class ReflectionTaskAuthorityRepository {
  constructor(private readonly tx: DataTransaction) {}
  async lockToken(tokenHash: string) {
    return (await this.tx.select().from(reflectionTaskAuthorities).where(eq(reflectionTaskAuthorities.tokenHash, tokenHash)).limit(1).for("update"))[0] ?? null;
  }
  async lockLive(taskId: string, section: string) {
    return (await this.tx.select().from(reflectionTaskAuthorities).where(and(eq(reflectionTaskAuthorities.taskId, taskId), eq(reflectionTaskAuthorities.section, section), isNull(reflectionTaskAuthorities.revokedAt))).limit(1).for("update"))[0] ?? null;
  }
  async create(input: typeof reflectionTaskAuthorities.$inferInsert) { await this.tx.insert(reflectionTaskAuthorities).values(input); }
  async renew(tokenHash: string, expiresAt: Date, tokenCiphertext: string) {
    const rows = await this.tx.update(reflectionTaskAuthorities).set({ expiresAt, tokenCiphertext, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(reflectionTaskAuthorities.tokenHash, tokenHash), isNull(reflectionTaskAuthorities.revokedAt))).returning({ tokenHash: reflectionTaskAuthorities.tokenHash });
    return rows.length === 1;
  }
  async revoke(tokenHash: string) {
    await this.tx.update(reflectionTaskAuthorities).set({ revokedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(reflectionTaskAuthorities.tokenHash, tokenHash), isNull(reflectionTaskAuthorities.revokedAt)));
  }
  async revokeTask(taskId: string) {
    await this.tx.update(reflectionTaskAuthorities).set({ revokedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(reflectionTaskAuthorities.taskId, taskId), isNull(reflectionTaskAuthorities.revokedAt)));
  }
  async verifyAggregate(row: { taskId: string; section: string; threadId: string; serviceClientId: string; authUserId: string; canonicalUserId: bigint }) {
    const result = await this.tx.select({ id: reflection_task.id }).from(reflection_task)
      .innerJoin(reflection_task_section, and(eq(reflection_task_section.task_id, reflection_task.id), eq(reflection_task_section.section, row.section)))
      .innerJoin(chat_thread, eq(chat_thread.id, reflection_task_section.thread_id))
      .where(and(eq(reflection_task.id, row.taskId), eq(reflection_task.status, "RUNNING"), eq(reflection_task.service_client_id, row.serviceClientId), eq(reflection_task.auth_user_id, row.authUserId), eq(reflection_task.user_id, sql`${row.canonicalUserId}::bigint`), eq(reflection_task_section.status, "RUNNING"), eq(reflection_task_section.thread_id, row.threadId), eq(chat_thread.user_id, reflection_task.user_id))).limit(1).for("share");
    return result.length === 1;
  }
}
