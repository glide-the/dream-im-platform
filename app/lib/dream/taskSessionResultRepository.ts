// [Input] Canonical actor or trusted service claim, exact task/turn/message identities and one data transaction.
// [Output] Owner-checked completion notices and revision-fenced delivery transitions.
// [Pos] Admin Drizzle owner of task-result SQL; Dream owns SDK scheduling and observations.
// [Sync] 2026-09-27: recover service claims and upgrade uncertain results on exact late finals.
// [Sync] 2026-09-27: validate both final assistant turns before completion and delivery.
// [Sync] 2026-09-28: leave dispatching in place while any source grant is live, even after its first final commits.
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { chat_input_queue as inputQueue, chat_message as message, chat_task_result as result, chat_task_session as task, chat_thread as thread } from "@ink-memory/db/schema/dream";
import { runtimeDelegations } from "@ink-memory/db/schema/auth";
import { adminAuditLogs } from "@ink-memory/db/schema";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import type { DataTransaction } from "./database";
import { pgTimestampToIso, validFinalProjection } from "./chatThreadDto";
import { taskResultDto, type resultCommitInputDto, type resultClaimInputDto, type resultSettleInputDto } from "./taskSessionResultDto";
import type { z } from "zod";

type FinalRow = { id: string; thread_id: string; role: string; parts: string; metadata: string | null; history_final_text: string | null; history_process_available: boolean; history_projection_version: number | null };
function finalTurn(row: FinalRow | undefined, threadId: string, turnId: string, notificationId?: string) {
  if (!row || row.thread_id !== threadId || row.role !== "assistant" || row.history_projection_version !== 1 || !row.history_final_text?.trim()) return false;
  try {
    const parts: unknown = JSON.parse(row.parts);
    const metadata: unknown = row.metadata === null ? null : JSON.parse(row.metadata);
    if (!Array.isArray(parts) || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
    const values = metadata as Record<string, unknown>;
    return values.turnId === turnId && (notificationId === undefined || values.taskResultNotificationId === notificationId)
      && validFinalProjection({ role: row.role, parts, metadata: values, history_final_text: row.history_final_text,
        history_process_available: row.history_process_available, history_projection_version: row.history_projection_version });
  } catch { return false; }
}

const finalFields = { id: message.id, thread_id: message.thread_id, role: message.role, parts: message.parts,
  metadata: message.metadata, history_final_text: message.history_final_text,
  history_process_available: message.history_process_available, history_projection_version: message.history_projection_version };

export class TaskSessionResultRepository {
  constructor(private readonly tx: DataTransaction) {}

  private async taskRow(taskId: string) {
    return (await this.tx.select().from(task).where(eq(task.id, taskId)).limit(1))[0] ?? null;
  }
  private async taskForTarget(threadId: string) {
    return (await this.tx.select().from(task).where(eq(task.thread_id, threadId)).limit(1))[0] ?? null;
  }
  private async ownedThread(threadId: string, actorId: string) {
    return (await this.tx.select({ id: thread.id, claude_session_id: thread.claude_session_id })
      .from(thread).where(and(eq(thread.id, threadId), eq(thread.user_id, sql`${actorId}::bigint`))).limit(1))[0] ?? null;
  }
  private async finalMessage(messageId: string) {
    return (await this.tx.select(finalFields).from(message).where(eq(message.id, messageId)).limit(1))[0];
  }
  private async sourceFinals(row: typeof result.$inferSelect) {
    if (!row.source_turn_id) return [];
    const candidates = await this.tx.select(finalFields).from(message)
      .where(and(eq(message.thread_id, row.source_thread_id), eq(message.role, "assistant"),
        eq(message.history_projection_version, 1)));
    return candidates.filter(candidate => finalTurn(candidate, row.source_thread_id, row.source_turn_id!, row.id));
  }
  private async row(notificationId: string, lock = false) {
    const query = this.tx.select().from(result).where(eq(result.id, notificationId)).limit(1);
    return (lock ? await query.for("update") : await query)[0] ?? null;
  }
  private async project(row: typeof result.$inferSelect) {
    const relation = await this.taskRow(row.task_id);
    if (!relation || relation.source_thread_id !== row.source_thread_id) throw new AuthBoundaryError("TASK_SESSION_RESULT_INTEGRITY_INVALID");
    const final = await this.finalMessage(row.target_final_message_id);
    if (!finalTurn(final, relation.thread_id, row.target_turn_id)) throw new AuthBoundaryError("TASK_SESSION_RESULT_INTEGRITY_INVALID");
    return taskResultDto.parse({ notification_id: row.id, task_id: row.task_id,
      source_thread_id: row.source_thread_id, target_thread_id: relation.thread_id,
      target_turn_id: row.target_turn_id, target_final_message_id: row.target_final_message_id,
      title: relation.title, final_text: final!.history_final_text,
      status: row.status, revision: row.revision, claim_id: row.claim_id,
      source_turn_id: row.source_turn_id, source_input_message_id: row.source_input_message_id,
      source_final_message_id: row.source_final_message_id,
      error_code: row.error_code, created_at: pgTimestampToIso(row.created_at), updated_at: pgTimestampToIso(row.updated_at) });
  }

  async commit(input: z.infer<typeof resultCommitInputDto>, actorId: string) {
    if (!await this.ownedThread(input.target_thread_id, actorId)) throw new AuthBoundaryError("CHAT_THREAD_NOT_FOUND", 404);
    const relation = await this.taskForTarget(input.target_thread_id);
    if (!relation || !relation.return_result) return null;
    if (relation.user_id.toString() !== actorId || !await this.ownedThread(relation.source_thread_id, actorId))
      throw new AuthBoundaryError("TASK_SESSION_NOT_FOUND", 404);
    const final = await this.finalMessage(input.target_final_message_id);
    if (!finalTurn(final, relation.thread_id, input.target_turn_id)) throw new AuthBoundaryError("TASK_SESSION_FINAL_NOT_COMMITTED", 409);
    const inserted = await this.tx.insert(result).values({ id: randomUUID(), task_id: relation.id,
      target_turn_id: input.target_turn_id, target_final_message_id: input.target_final_message_id,
      source_thread_id: relation.source_thread_id }).onConflictDoNothing({ target: [result.task_id, result.target_turn_id] }).returning();
    const stored = inserted[0] ?? (await this.tx.select().from(result).where(and(eq(result.task_id, relation.id), eq(result.target_turn_id, input.target_turn_id))).limit(1))[0];
    if (!stored || stored.target_final_message_id !== input.target_final_message_id || stored.source_thread_id !== relation.source_thread_id) throw new AuthBoundaryError("TASK_SESSION_RESULT_IDENTITY_CONFLICT", 409);
    return this.project(stored);
  }

  async list(sourceThreadId: string, actorId: string, requestId: string) {
    if (!await this.ownedThread(sourceThreadId, actorId)) throw new AuthBoundaryError("CHAT_THREAD_NOT_FOUND", 404);
    await this.reconcileUnknown("user", actorId, requestId, sourceThreadId);
    const rows = await this.tx.select().from(result).where(eq(result.source_thread_id, sourceThreadId)).orderBy(asc(result.created_at), asc(result.id));
    return Promise.all(rows.map(row => this.project(row)));
  }

  async reconcileUnknown(actorType: "user" | "service", actorId: string, requestId: string,
    sourceThreadId: string | null = null) {
    let cursor: { created_at: string; id: string } | null = null;
    for (;;) {
      const after = cursor === null ? undefined : or(gt(result.created_at, cursor.created_at),
        and(eq(result.created_at, cursor.created_at), gt(result.id, cursor.id)));
      const current = (await this.tx.select().from(result).where(and(eq(result.status, "state_unknown"),
        sourceThreadId === null ? undefined : eq(result.source_thread_id, sourceThreadId), after))
        .orderBy(asc(result.created_at), asc(result.id)).limit(1).for("update"))[0];
      if (!current) return;
      cursor = { created_at: current.created_at, id: current.id };
      const finals = await this.sourceFinals(current);
      if (finals.length !== 1) continue;
      const updated = (await this.tx.update(result).set({ status: "delivered", revision: current.revision + 1,
        source_final_message_id: finals[0].id, error_code: null, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(result.id, current.id), eq(result.revision, current.revision),
          eq(result.status, "state_unknown"))).returning({ id: result.id }))[0];
      if (!updated) throw new AuthBoundaryError("TASK_SESSION_RESULT_REVISION_CONFLICT", 409);
      await this.tx.insert(adminAuditLogs).values({ id: `audit_${randomUUID().replaceAll("-", "")}`,
        actor_type: actorType, actor_id: actorId, action: "dream.task-session.result-reconcile",
        resource_type: "chat_task_result", resource_id: current.id, request_id: requestId,
        metadata: { status: "delivered", revision: current.revision + 1, source_final_message_id: finals[0].id } });
    }
  }

  async nextPending(after: { created_at: string; id: string } | null) {
    const cursor = after === null ? undefined : or(gt(result.created_at, after.created_at),
      and(eq(result.created_at, after.created_at), gt(result.id, after.id)));
    return (await this.tx.select({ id: result.id, revision: result.revision,
      created_at: result.created_at, task_id: result.task_id })
      .from(result).where(and(eq(result.status, "pending"), cursor))
      .orderBy(asc(result.created_at), asc(result.id)).limit(1)
      .for("update", { skipLocked: true }))[0] ?? null;
  }
  async reconcileDispatching(serviceId: string, requestId: string) {
    let cursor: { created_at: string; id: string } | null = null;
    for (;;) {
      const after = cursor === null ? undefined : or(gt(result.created_at, cursor.created_at),
        and(eq(result.created_at, cursor.created_at), gt(result.id, cursor.id)));
      const current = (await this.tx.select().from(result).where(and(eq(result.status, "dispatching"), after))
        .orderBy(asc(result.created_at), asc(result.id)).limit(1)
        .for("update", { skipLocked: true }))[0];
      if (!current) break;
      cursor = { created_at: current.created_at, id: current.id };
      const finals = await this.sourceFinals(current);
      const grants = await this.tx.select({ purpose: runtimeDelegations.purpose,
        active: sql<boolean>`${runtimeDelegations.expiresAt} > clock_timestamp() AND ${runtimeDelegations.revokedAt} IS NULL` })
        .from(runtimeDelegations).where(and(eq(runtimeDelegations.authoritySource, "task-result-claim"),
          eq(runtimeDelegations.sourceTaskResultId, current.id),
          eq(runtimeDelegations.sourceTaskResultClaimId, current.claim_id!)));
      // A committed first result turn is not the end of its Factory owner:
      // queued user input can still use the same claim grants. Only a settled
      // owner may revoke them; recovery waits until every grant is inactive.
      const anyActiveGrant = grants.some(grant => grant.active);
      const next = anyActiveGrant ? null : finals.length === 1 ? "delivered" : "state_unknown";
      if (next === null) continue;
      const updated = (await this.tx.update(result).set({ status: next, revision: current.revision + 1,
        source_final_message_id: next === "delivered" ? finals[0].id : null,
        error_code: next === "state_unknown" ? "TASK_SESSION_RETURN_STATE_UNKNOWN" : null,
        updated_at: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(result.id, current.id), eq(result.revision, current.revision), eq(result.status, "dispatching"))).returning({ id: result.id }))[0];
      if (!updated) throw new AuthBoundaryError("TASK_SESSION_RESULT_REVISION_CONFLICT", 409);
      await this.tx.insert(adminAuditLogs).values({ id: `audit_${randomUUID().replaceAll("-", "")}`,
        actor_type: "service", actor_id: serviceId, action: "dream.task-session.result-reconcile",
        resource_type: "chat_task_result", resource_id: current.id, request_id: requestId,
        metadata: { status: next, revision: current.revision + 1 } });
    }
    await this.reconcileUnknown("service", serviceId, requestId);
  }
  async byClaimRequestKey(key: string) {
    return (await this.tx.select().from(result).where(eq(result.claim_request_key, key)).limit(1))[0] ?? null;
  }

  async taskActor(taskId: string) {
    const relation = await this.taskRow(taskId);
    return relation?.user_id.toString() ?? null;
  }

  async claim(input: z.infer<typeof resultClaimInputDto>, claimRequestKey: string | null = null) {
    const current = await this.row(input.notification_id, true);
    if (!current) throw new AuthBoundaryError("TASK_SESSION_RESULT_NOT_FOUND", 404);
    const replay = current.status === "dispatching" && current.revision === input.expected_revision + 1
      && current.source_turn_id === input.source_turn_id && !!current.claim_id
      && (claimRequestKey === null || current.claim_request_key === claimRequestKey);
    if (!replay && (current.revision !== input.expected_revision || current.status !== "pending"))
      throw new AuthBoundaryError("TASK_SESSION_RESULT_REVISION_CONFLICT", 409);
    const relation = await this.taskRow(current.task_id);
    const actorId = relation?.user_id.toString();
    if (!relation || !actorId || !relation.return_result || relation.source_thread_id !== current.source_thread_id
      || !await this.ownedThread(relation.thread_id, actorId)) throw new AuthBoundaryError("TASK_SESSION_RESULT_INTEGRITY_INVALID");
    const source = await this.ownedThread(current.source_thread_id, actorId);
    if (!source?.claude_session_id) throw new AuthBoundaryError("TASK_SESSION_RETURN_UNAVAILABLE", 409);
    if (!replay) {
      await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`task-result:${current.source_thread_id}`}, 0))`);
      const blockedInput = await this.tx.select({ id: inputQueue.message_id }).from(inputQueue)
        .where(and(eq(inputQueue.thread_id, current.source_thread_id),
          inArray(inputQueue.status, ["queued", "selected", "dispatching", "state_unknown"]))).limit(1);
      if (blockedInput[0]) throw new AuthBoundaryError("TASK_SESSION_RETURN_INPUT_PENDING", 409);
      const activeResult = await this.tx.select({ id: result.id }).from(result)
        .where(and(eq(result.source_thread_id, current.source_thread_id), eq(result.status, "dispatching"))).limit(1);
      if (activeResult[0]) throw new AuthBoundaryError("TASK_SESSION_RETURN_DISPATCH_CONFLICT", 409);
    }
    const claimId = current.claim_id ?? randomUUID();
    const projection = await this.project(current);
    const sourceInputText = `独立任务「${projection.title}」已完成，结果：\n${projection.final_text}`;
    const maximumInputBytes = Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES"));
    if (!Number.isSafeInteger(maximumInputBytes) || maximumInputBytes < 1
      || Buffer.byteLength(JSON.stringify([{ type: "text", text: sourceInputText }]), "utf8") > maximumInputBytes)
      throw new AuthBoundaryError("TASK_SESSION_RETURN_INPUT_TOO_LARGE", 409);
    const sourceInputMessageId = current.source_input_message_id ?? randomUUID();
    if (!replay) await this.tx.insert(message).values({ id: sourceInputMessageId, thread_id: current.source_thread_id,
      role: "user", parts: JSON.stringify([{ type: "text", text: sourceInputText }]),
      metadata: JSON.stringify({ kind: "task-session-result", taskResultNotificationId: current.id,
        taskId: current.task_id, targetTurnId: current.target_turn_id, claimId,
        sourceTurnId: input.source_turn_id }) });
    const updated = replay ? current : (await this.tx.update(result).set({ status: "dispatching", revision: current.revision + 1,
      claim_id: claimId, claim_request_key: claimRequestKey,
      source_turn_id: input.source_turn_id, source_input_message_id: sourceInputMessageId,
      updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(result.id, current.id), eq(result.revision, current.revision), eq(result.status, "pending"))).returning())[0];
    if (!updated) throw new AuthBoundaryError("TASK_SESSION_RESULT_REVISION_CONFLICT", 409);
    if (replay) {
      const persisted = await this.finalMessage(sourceInputMessageId);
      if (!persisted || persisted.thread_id !== current.source_thread_id || persisted.role !== "user"
        || persisted.parts !== JSON.stringify([{ type: "text", text: sourceInputText }]))
        throw new AuthBoundaryError("TASK_SESSION_RESULT_INTEGRITY_INVALID");
    }
    return { result: await this.project(updated), sourceSessionId: source.claude_session_id,
      sourceInputMessageId, sourceInputText, actorId, claimId,
      notificationId: updated.id, sourceThreadId: updated.source_thread_id };
  }

  async settle(input: z.infer<typeof resultSettleInputDto>) {
    const current = await this.row(input.notification_id, true);
    if (!current) throw new AuthBoundaryError("TASK_SESSION_RESULT_NOT_FOUND", 404);
    if (current.revision !== input.expected_revision || current.status !== "dispatching" || current.claim_id !== input.claim_id
      || !current.source_turn_id) throw new AuthBoundaryError("TASK_SESSION_RESULT_REVISION_CONFLICT", 409);
    let sourceFinalMessageId: string | null = null;
    if (input.action === "delivered") {
      const finals = await this.sourceFinals(current);
      if (finals.length !== 1) throw new AuthBoundaryError("TASK_SESSION_SOURCE_FINAL_NOT_COMMITTED", 409);
      sourceFinalMessageId = finals[0].id;
    }
    const status = input.action === "mark_unknown" ? "state_unknown" : input.action;
    const updated = (await this.tx.update(result).set({ status, revision: current.revision + 1,
      source_final_message_id: sourceFinalMessageId,
      error_code: input.action === "delivered" ? null : input.error_code,
      updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(result.id, current.id), eq(result.revision, current.revision), eq(result.status, "dispatching"), eq(result.claim_id, input.claim_id))).returning())[0];
    if (!updated) throw new AuthBoundaryError("TASK_SESSION_RESULT_REVISION_CONFLICT", 409);
    return this.project(updated);
  }
}
