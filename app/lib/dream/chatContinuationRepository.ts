// [Sync] 2026-11-27: 在原 Thread 锁内复核续期授权并结束中断的普通输入。
// [Input] Authenticated Chat owner, locked Thread, exact history digest and attempt identity.
// [Output] Consistent canonical history, one durable queue claim and monotonic query phase.
// [Pos] Admin-only continuation UOW; reuses Chat messages, queue and operation receipts.
// [Sync] 2026-11-04: preserve one Thread/session across independent execution workspaces.
// [Sync] 2026-11-26: retire interrupted ordinary turns when their persistence authority ends.
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { chat_input_queue as queue, chat_message as message } from "@ink-memory/db/schema/dream";
import { runtimeDelegations as grants } from "@ink-memory/db/schema/auth";
import { chatAutoTitleCapacity } from "../../../config/dream-domain-policy";
import { stripPythonString } from "./deckPluginManifestDto";
import { AuthBoundaryError } from "../auth/config";
import { ChatThreadRepository } from "./chatThreadRepository";
import { canonicalMessageJson, continuationClaimInputDto, continuationProgressInputDto, continuationSnapshotInputDto } from "./chatThreadDto";
import type { DataTransaction } from "./database";

export class ChatContinuationRepository {
  private readonly chat: ChatThreadRepository;
  constructor(private readonly tx: DataTransaction, actorId: string) { this.chat = new ChatThreadRepository(tx, actorId); }
  // Queue reads project the outcome that the next claim commits under the Thread lock.
  async inputs(threadId: string, retire = false, listed?: Awaited<ReturnType<ChatThreadRepository["listInputs"]>>) {
    const entries = listed ?? await this.chat.listInputs(threadId);
    if (!entries.some(row => row.status === "dispatching" || row.status === "state_unknown")) return entries;
    if (retire) {
      // Serialize the takeover with an in-flight renewal of a candidate grant.
      await this.tx.select({ id: grants.requestId }).from(grants).innerJoin(queue, eq(queue.thread_id, grants.threadId))
        .where(and(eq(queue.thread_id, threadId), eq(grants.purpose, "server-persistence"),
          sql`${queue.status} IN ('dispatching','state_unknown')`,
          sql`${grants.createdAt} <= ${queue.updated_at} AND ${grants.expiresAt} >= ${queue.updated_at}`))
        .for("share");
    }
    // Legacy owners are random UUIDs. Conservatively include every grant valid at the claim.
    const ownerLive = sql<boolean | null>`(
      SELECT bool_or(candidate.live) FROM (
        SELECT ${grants.requestId} = ${queue.continuation_owner}::text AS exact,
               (${grants.revokedAt} IS NULL AND ${grants.expiresAt} > clock_timestamp()) AS live,
               bool_or(${grants.requestId} = ${queue.continuation_owner}::text) OVER () AS has_exact
        FROM ${grants}
        WHERE ${grants.threadId} = ${queue.thread_id}
          AND ${grants.canonicalUserId} = ${this.chat.canonicalUserId}::bigint
          AND ${grants.purpose} = 'server-persistence'
          AND ${grants.createdAt} <= ${queue.updated_at}
          AND ${grants.expiresAt} >= ${queue.updated_at}
          AND (${grants.revokedAt} IS NULL OR ${grants.revokedAt} >= ${queue.updated_at})
      ) candidate WHERE candidate.exact OR NOT coalesce(candidate.has_exact, false)
    )`;
    const pending = await this.tx.select({ id: queue.message_id, turn: queue.dispatch_turn_id,
      revision: queue.revision, status: queue.status, ownerLive, metadata: message.metadata })
      .from(queue).innerJoin(message, eq(message.id, queue.message_id))
      .where(and(eq(queue.thread_id, threadId), sql`${queue.continuation_owner} IS NOT NULL`,
        sql`${queue.status} IN ('dispatching','state_unknown')`));
    const interrupted = pending.filter(row => {
      if (row.status !== "state_unknown" && row.ownerLive !== false) return false;
      // Server-authored workflows retain their own settlement protocol.
      if (row.metadata === null) return true;
      try { const meta = JSON.parse(row.metadata); return meta && typeof meta === "object" && !Array.isArray(meta) && !meta.kind; }
      catch { return false; }
    });
    if (!interrupted.length) return entries;
    const messages = await this.chat.messages(threadId);
    for (const row of interrupted) {
      const entry = entries.find(item => item.message_id === row.id);
      if (!entry) continue;
      const completed = messages.some(item => item.role === "assistant" && item.metadata?.turnId === row.turn
        && item.metadata?.turnStatus === "completed" && item.metadata.is_partial !== true);
      entry.status = completed ? "consumed" : "failed";
      if (retire) {
        await this.tx.update(queue).set({ status: entry.status, revision: row.revision + 1, updated_at: sql`CURRENT_TIMESTAMP` })
          .where(and(eq(queue.message_id, row.id), eq(queue.revision, row.revision)));
      }
    }
    return entries;
  }
  async snapshot(input: z.infer<typeof continuationSnapshotInputDto>, retire = false) {
    await this.chat.requireOwned(input.thread_id, true);
    const bound = await this.chat.get(input.thread_id);
    if (!bound) throw new AuthBoundaryError("CHAT_THREAD_NOT_FOUND", 404);
    const queued = await this.inputs(input.thread_id, retire);
    if (queued.some(v => ["dispatching", "state_unknown"].includes(v.status) && !((input.message_id === null || v.message_id === input.message_id) && input.dispatch_turn_id !== null && v.dispatch_turn_id === input.dispatch_turn_id && v.status === "dispatching"))) throw new AuthBoundaryError("CHAT_CONTINUATION_BUSY", 409);
    const managed = await this.tx.select({ message_id: queue.message_id, turn_id: queue.dispatch_turn_id, owner: queue.continuation_owner, sequence: queue.queue_sequence, phase: queue.continuation_phase, status: queue.status }).from(queue).where(eq(queue.thread_id, input.thread_id));
    const statuses = new Map(queued.map(row => [row.message_id, row.status]));
    for (const row of managed) row.status = statuses.get(row.message_id) ?? row.status;
    const ended = new Set(managed.filter(v => v.status === "failed" && v.phase === "armed" && bound.claude_session_id !== null).map(v => v.message_id));
    const excluded = new Set(queued.filter(v => v.status !== "consumed" && !ended.has(v.message_id) && !(input.message_id === null && input.dispatch_turn_id !== null && v.dispatch_turn_id === input.dispatch_turn_id && v.status === "dispatching")).map(v => v.message_id));
    const excludedTurns = new Set(managed.filter(v => excluded.has(v.message_id)).map(v => v.turn_id));
    const canonical = (await this.chat.messages(input.thread_id)).filter(v => v.id !== input.message_id && !excluded.has(v.id) && !(v.role === "assistant" && excludedTurns.has(String(v.metadata?.turnId))));
    const groups = managed.filter(v => v.owner && canonical.some(m => m.id === v.message_id)).sort((a,b) => a.sequence < b.sequence ? -1 : a.sequence > b.sequence ? 1 : 0).map(v => {
      const user = canonical.find(m => m.id === v.message_id)!;
      const replies = canonical.filter(m => m.role === "assistant" && m.metadata?.turnId === v.turn_id);
      if (v.status === "failed" && v.phase === "armed") {
        if (replies.length > 1 || replies.some(m => !["cancelled", "error"].includes(String(m.metadata?.turnStatus)))) throw new AuthBoundaryError("CHAT_CONTINUATION_RESULT_UNKNOWN", 409);
        return [user, ...replies];
      }
      if (replies.length !== 1 || replies[0].metadata?.turnStatus !== "completed" || replies[0].metadata?.is_partial === true) throw new AuthBoundaryError("CHAT_CONTINUATION_RESULT_UNKNOWN", 409);
      return [user, replies[0]];
    });
    const assigned = new Set(groups.flat().map(v => v.id));
    const messages = [...canonical.filter(v => !assigned.has(v.id)), ...groups.flat()];
    const history_digest = createHash("sha256").update(canonicalMessageJson({ session: bound.claude_session_id, contract: bound.agent_contract_version, messages })).digest("hex");
    return { thread: bound, messages, history_digest };
  }
  async claim(input: z.infer<typeof continuationClaimInputDto>) {
    const snapshot = await this.snapshot({ thread_id: input.thread_id, message_id: input.message_id, dispatch_turn_id: input.dispatch_turn_id }, true);
    if (snapshot.history_digest !== input.history_digest || snapshot.thread.claude_session_id !== input.claude_session_id) throw new AuthBoundaryError("CHAT_CONTINUATION_HISTORY_CHANGED", 409);
    const prior = (await this.tx.select().from(queue).where(and(eq(queue.thread_id, input.thread_id), eq(queue.message_id, input.message_id))).limit(1))[0];
    const safeRetry = prior?.status === "failed" && prior.continuation_phase === "prepared" && !!prior.continuation_owner;
    if (prior?.continuation_owner && !safeRetry || prior?.status === "failed" && !safeRetry || prior && !["queued", "selected", "dispatching", "failed"].includes(prior.status)) throw new AuthBoundaryError("CHAT_CONTINUATION_ALREADY_CLAIMED", 409);
    const stored = (await this.chat.messages(input.thread_id)).find(v => v.id === input.message_id);
    if (stored) {
      if (stored.role !== "user" || canonicalMessageJson(stored.parts) !== canonicalMessageJson(JSON.parse(input.parts_json)) || canonicalMessageJson(stored.metadata) !== canonicalMessageJson(input.metadata_json === null ? null : JSON.parse(input.metadata_json))) throw new AuthBoundaryError("CHAT_MESSAGE_IDENTITY_CONFLICT", 409);
      // Only a pre-existing authoritative queue/technical dispatch may adopt an already saved input.
      if (!prior && !["scheduled-chat", "task-session-result", "story-workspace-dream-confirmation", "story-workspace-dream-auto-repair"].includes(String(stored.metadata?.kind))) throw new AuthBoundaryError("CHAT_CONTINUATION_RESULT_UNKNOWN", 409);
      if (!prior) await this.tx.insert(queue).values({ message_id: input.message_id, thread_id: input.thread_id });
    } else {
      await this.chat.enqueueInput({ ...input, title_candidate: [...stripPythonString(input.title_candidate)].slice(0, chatAutoTitleCapacity()).join("") });
    }
    const current = (await this.chat.listInputs(input.thread_id)).find(v => v.message_id === input.message_id)!;
    await this.tx.update(queue).set({ status: "dispatching", dispatch_turn_id: input.dispatch_turn_id, continuation_owner: input.owner, continuation_phase: "prepared", revision: current.revision + 1, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(queue.message_id, input.message_id), eq(queue.revision, current.revision)));
    return { entry: (await this.chat.listInputs(input.thread_id)).find(v => v.message_id === input.message_id)! };
  }
  async progress(input: z.infer<typeof continuationProgressInputDto>) {
    await this.chat.requireOwned(input.thread_id, true);
    const row = (await this.tx.select().from(queue).where(and(eq(queue.thread_id, input.thread_id), eq(queue.message_id, input.message_id))).limit(1))[0];
    if (!row || row.continuation_owner !== input.owner || row.dispatch_turn_id !== input.dispatch_turn_id || row.revision !== input.expected_revision || row.status !== "dispatching") throw new AuthBoundaryError("CHAT_CONTINUATION_CLAIM_CONFLICT", 409);
    if (input.action === "arm_query" && row.continuation_phase !== "prepared" || input.action === "fail_before_query" && row.continuation_phase !== "prepared") throw new AuthBoundaryError("CHAT_CONTINUATION_PHASE_CONFLICT", 409);
    if (input.action === "fail_after_query" && row.continuation_phase !== "armed") throw new AuthBoundaryError("CHAT_CONTINUATION_PHASE_CONFLICT", 409);
    if (input.action === "complete") {
      if (row.continuation_phase !== "armed") throw new AuthBoundaryError("CHAT_CONTINUATION_PHASE_CONFLICT", 409);
      const completed = (await this.chat.messages(input.thread_id)).some(v => v.role === "assistant" && v.metadata?.turnId === input.dispatch_turn_id && v.metadata?.turnStatus === "completed" && v.metadata?.is_partial !== true);
      if (!completed) throw new AuthBoundaryError("CHAT_CONTINUATION_RESULT_UNKNOWN", 409);
    }
    const status = input.action === "arm_query" ? "dispatching" : input.action === "complete" ? "consumed" : ["fail_before_query", "fail_after_query"].includes(input.action) ? "failed" : "state_unknown";
    await this.tx.update(queue).set({ status, continuation_phase: input.action === "arm_query" ? "armed" : row.continuation_phase, revision: row.revision + 1, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(queue.message_id, input.message_id), eq(queue.revision, row.revision)));
    return { entry: (await this.chat.listInputs(input.thread_id)).find(v => v.message_id === input.message_id)! };
  }
  async create(input: { deck_id?: string | null; voice_id?: string | null; title?: string | null; created_execution_origin?: string }) {
    return this.chat.create(input, input.created_execution_origin ?? null);
  }
}
