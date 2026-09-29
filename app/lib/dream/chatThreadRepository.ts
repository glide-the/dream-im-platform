// [Sync] 2026-09-27: atomically publish target completion and freeze return intent without changing legacy create semantics.
// [Sync] 2026-09-28: keep ordinary task creation compatible with pre-0068 schema and require exact capability for returning tasks.
// [Sync] 2026-09-27: project owner-filtered source and created task-session navigation links.
// [Sync] 2026-09-29: keep scheduled-trigger task sessions out of generic conversation task links.
// [Sync] 2026-09-27: atomically bind a task to a new Thread and claim its first SDK launch once.
// [Sync] 2026-09-26: atomically persist queued user messages and revisioned per-Thread claims.
// [Input] Admin-authenticated canonical identity, typed DTOs and an existing Drizzle transaction.
// [Output] Owner-filtered Thread/message persistence with CAS, immutable replay and exact keyset order.
// [Pos] Primary-owned Admin Repository; no HTTP orchestration or independent transaction.
// [Sync] 2026-09-15: raw user-message/title aggregate and stored confirmation guard preserve current leases.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, notExists, sql } from "drizzle-orm";
import { bigint, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { chat_thread as thread, chat_message as message, chat_input_queue as inputQueue, chat_task_session as taskSession, chat_scheduled_trigger as scheduledTrigger, decks, voices } from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { canonicalMessageJson, chatThreadDto, chatThreadSummaryDto, decodeChatMessage, pgTimestampToIso, messagePersistInputDto, queueEntryDto, taskSessionDto, taskSessionLinkDto, taskSessionSourceLinkDto, type MessagePersistInput } from "./chatThreadDto";
import { z } from "zod";
import {canonicalBusinessJson} from "./deckContentCanonical";
import {guardPersistedDreamConfirmation,type ConfirmationGuardInput} from "./confirmationGuard";
import { messagePageInputDto, threadCreateInputDto, threadListInputDto, threadSelectVoiceInputDto, queueEnqueueInputDto, queueTransitionInputDto, taskSessionCreateInputDto, taskSessionLaunchInputDto } from "./chatThreadDto";
import { hasSchemaCapability } from "./database";
import chatTaskResultContract from "../../../drizzle/contracts/dream-chat-task-result-v1.json";
import scheduledLinkLifecycleContract from "../../../drizzle/contracts/dream-chat-scheduled-link-lifecycle-v1.json";
import { TaskSessionResultRepository } from "./taskSessionResultRepository";

const taskResultCapability = { capability: "dream.chat-task-result.v1", version: 1,
  contractSha256: chatTaskResultContract.contract_sha256 } as const;
const scheduledLinkLifecycleCapability = { capability: "dream.chat-scheduled-link-lifecycle.v1", version: 1,
  contractSha256: scheduledLinkLifecycleContract.contract_sha256 } as const;
// Drizzle's insert builder emits DEFAULT for every mapped column. Keep the
// pre-0068 shape until the exact result capability is published.
const preResultTaskSession = pgTable("chat_task_session", {
  id: text().primaryKey().notNull(), user_id: bigint({ mode: "number" }).notNull(),
  source_thread_id: text().notNull(), thread_id: text().notNull(),
  request_key: text().notNull(), initial_message_id: text().notNull(),
  title: text().notNull(), launch_status: text().default("pending").notNull(),
  launch_error_code: text(), created_at: timestamp({ withTimezone: true, mode: "string" }).defaultNow().notNull(),
});
const taskSessionInsertFields = { id: taskSession.id, source_thread_id: taskSession.source_thread_id,
  thread_id: taskSession.thread_id, title: taskSession.title,
  initial_message_id: taskSession.initial_message_id, launch_status: taskSession.launch_status,
  launch_error_code: taskSession.launch_error_code, created_at: taskSession.created_at };
const preResultTaskSessionInsertFields = { id: preResultTaskSession.id,
  source_thread_id: preResultTaskSession.source_thread_id, thread_id: preResultTaskSession.thread_id,
  title: preResultTaskSession.title, initial_message_id: preResultTaskSession.initial_message_id,
  launch_status: preResultTaskSession.launch_status, launch_error_code: preResultTaskSession.launch_error_code,
  created_at: preResultTaskSession.created_at };
const threadFields = { id: thread.id, user_id: sql<string>`${thread.user_id}::text`, title: thread.title, deck_id: thread.deck_id, voice_id: thread.voice_id, claude_session_id: thread.claude_session_id, agent_contract_version: thread.agent_contract_version, created_at: thread.created_at, updated_at: thread.updated_at };
const summaryFields = { id: thread.id, title: thread.title, deck_id: thread.deck_id, voice_id: thread.voice_id, created_at: thread.created_at, updated_at: thread.updated_at };
const fullMessageFields = { id: message.id, role: message.role, parts: message.parts, metadata: message.metadata, created_at: message.created_at };
const pageMessageFields = { ...fullMessageFields,
  parts: sql<string | null>`CASE WHEN ${message.role} = 'assistant' AND ${message.history_projection_version} = 1 AND ${message.history_final_text} IS NOT NULL AND btrim(${message.history_final_text}) <> '' THEN NULL ELSE ${message.parts} END`,
  history_final_text: message.history_final_text, history_process_available: message.history_process_available, history_projection_version: message.history_projection_version,
};
const messageDescending = [sql`${message.created_at} DESC NULLS LAST`, sql`${message.id} DESC NULLS LAST`];
const queueFields = {
  message_id: inputQueue.message_id, thread_id: inputQueue.thread_id,
  queue_sequence: inputQueue.queue_sequence, status: inputQueue.status,
  revision: inputQueue.revision, dispatch_turn_id: inputQueue.dispatch_turn_id,
  created_at: inputQueue.created_at,
};
function projectQueueEntry(row: { message_id: string; thread_id: string; queue_sequence: bigint; status: string; revision: number; dispatch_turn_id: string | null; created_at: string; parts: string }) {
  let text = "";
  try {
    const parts: unknown = JSON.parse(row.parts);
    if (Array.isArray(parts)) text = parts.filter(part => part && typeof part === "object" && !Array.isArray(part) && part.type === "text" && typeof part.text === "string").map(part => part.text).join("\n");
  } catch { /* A malformed stored message has no queue preview. */ }
  const { parts: ignored, ...entry } = row; void ignored;
  return queueEntryDto.parse({ ...entry, text, queue_sequence: row.queue_sequence.toString(), created_at: pgTimestampToIso(row.created_at) });
}
function projectThread(row: Omit<typeof thread.$inferSelect, "user_id"> & { user_id: string }) {
  return chatThreadDto.parse({ ...row, user_id: String(row.user_id), created_at: pgTimestampToIso(row.created_at), updated_at: pgTimestampToIso(row.updated_at) });
}
function projectSummary(row: { id: string; title: string | null; deck_id: string | null; voice_id: string | null; created_at: string | null; updated_at: string | null }) {
  return chatThreadSummaryDto.parse({ ...row, created_at: pgTimestampToIso(row.created_at), updated_at: pgTimestampToIso(row.updated_at) });
}
export class ChatThreadRepository {
  readonly canonicalUserId: string;
  constructor(readonly transaction: DataTransaction, canonicalUserId: string) { this.canonicalUserId = decimalIdDto.parse(canonicalUserId); }
  private owned() { return eq(thread.user_id, sql`${this.canonicalUserId}::bigint`); }
  async get(threadId: string) {
    const rows = await this.transaction.select(threadFields).from(thread).where(and(eq(thread.id, threadId), this.owned())).limit(1);
    return rows[0] ? projectThread(rows[0]) : null;
  }
  async requireOwned(threadId: string, lock = false) {
    const query = this.transaction.select({ id: thread.id }).from(thread).where(and(eq(thread.id, threadId), this.owned())).limit(1);
    const rows = lock ? await query.for("update") : await query;
    if (!rows[0]) throw new AuthBoundaryError("CHAT_THREAD_NOT_FOUND", 404);
  }
  private async requireDeck(deckId: string, voiceId: string | null = null) {
    const rows = await this.transaction.select({ id: decks.id, enabled: decks.enabled }).from(decks).where(and(eq(decks.id, deckId), eq(decks.owner_id, sql`${this.canonicalUserId}::bigint`))).limit(1).for("share");
    if (!rows[0]) throw new AuthBoundaryError("DECK_ACCESS_DENIED", 404);
    if (!rows[0].enabled) throw new AuthBoundaryError("DECK_DISABLED", 409);
    if (voiceId !== null) {
      const agents = await this.transaction.select({ id: voices.id }).from(voices).where(and(eq(voices.id, voiceId), eq(voices.deck_id, deckId), eq(voices.enabled, true))).limit(1).for("share");
      if (!agents[0]) throw new AuthBoundaryError("AGENT_ACCESS_DENIED", 404);
    }
  }
  async create(input: z.infer<typeof threadCreateInputDto>) {
    if (input.deck_id !== null) await this.requireDeck(input.deck_id, input.voice_id);
    const id = randomUUID();
    await this.transaction.insert(thread).values({ id, user_id: sql`${this.canonicalUserId}::bigint`, title: input.title, deck_id: input.deck_id, voice_id: input.voice_id });
    return { thread_id: id, deck_id: input.deck_id, voice_id: input.voice_id };
  }
  async list(input: z.infer<typeof threadListInputDto>) {
    const query = this.transaction.select(summaryFields).from(thread).where(and(this.owned(), input.deck_id === null ? undefined : eq(thread.deck_id, input.deck_id))).orderBy(sql`${thread.updated_at} DESC`);
    const rows = input.limit === null ? await query : await query.limit(input.limit).offset(input.offset);
    return rows.map(projectSummary);
  }
  async search(deckId: string | null) {
    const rows = await this.transaction.select({ ...summaryFields, message_parts: message.parts }).from(thread).leftJoin(message, eq(message.thread_id, thread.id)).where(and(this.owned(), deckId === null ? undefined : eq(thread.deck_id, deckId))).orderBy(sql`${thread.updated_at} DESC`, asc(message.created_at));
    const byThread = new Map<string, ReturnType<typeof projectSummary> & { messages_text: string }>();
    const texts = new Map<string, string[]>();
    for (const row of rows) {
      if (!byThread.has(row.id)) { const { message_parts: ignored, ...summary } = row; void ignored; byThread.set(row.id, { ...projectSummary(summary), messages_text: "" }); texts.set(row.id, []); }
      try { const parts: unknown = JSON.parse(row.message_parts || "[]"); if (Array.isArray(parts)) { const text = parts.filter(p => p && typeof p === "object" && !Array.isArray(p) && p.type === "text").map(p => String(p.text || "").trim()).filter(Boolean).join("\n").trim(); if (text) texts.get(row.id)!.push(text); } } catch { /* preserve malformed-part search exclusion */ }
    }
    return [...byThread.values()].map(row => ({ ...row, messages_text: texts.get(row.id)!.join("\n\n") }));
  }
  async delete(threadId: string) {
    const rows = await this.transaction.delete(thread).where(and(eq(thread.id, threadId), this.owned())).returning({ id: thread.id });
    return rows.length > 0;
  }
  async bindDeck(threadId: string, deckId: string) {
    await this.requireOwned(threadId, true); await this.requireDeck(deckId);
    const rows = await this.transaction.update(thread).set({ deck_id: deckId, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(thread.id, threadId), this.owned(), isNull(thread.deck_id))).returning({ id: thread.id });
    if (rows.length) return true;
    const current = await this.get(threadId); return current?.deck_id === deckId;
  }
  async selectVoice(input: z.infer<typeof threadSelectVoiceInputDto>) {
    await this.requireOwned(input.thread_id, true); await this.requireDeck(input.deck_id, input.voice_id);
    const rows = await this.transaction.update(thread).set({ voice_id: input.voice_id, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(thread.id, input.thread_id), this.owned(), eq(thread.deck_id, input.deck_id), sql`${thread.voice_id} IS NOT DISTINCT FROM ${input.expected_voice_id}`)).returning({ id: thread.id });
    return rows.length === 1;
  }
  async updateTitle(threadId: string, title: string) {
    await this.requireOwned(threadId, true);
    const rows = await this.transaction.update(thread).set({ title, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(thread.id, threadId), this.owned())).returning({ id: thread.id }); return rows.length === 1;
  }
  async updateSession(threadId: string, sessionId: string, contractVersion: string) {
    await this.requireOwned(threadId, true);
    const rows = await this.transaction.update(thread).set({ claude_session_id: sessionId, agent_contract_version: contractVersion, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(thread.id, threadId), this.owned())).returning({ id: thread.id }); return rows.length === 1;
  }
  async persistMessage(input: MessagePersistInput) {
    messagePersistInputDto.parse(input); await this.requireOwned(input.thread_id, true);
    const parts = canonicalMessageJson(input.parts), metadata = input.metadata === null ? null : canonicalMessageJson(input.metadata);
    if(input.role === "user" && await guardPersistedDreamConfirmation(this.transaction,this.canonicalUserId,{thread_id:input.thread_id,message_id:input.message_id,parts_json:parts,metadata_json:metadata})) return input.message_id;
    const inserted = await this.transaction.insert(message).values({ id: input.message_id, thread_id: input.thread_id, role: input.role, parts, metadata, history_final_text: input.history_final_text, history_process_available: input.history_process_available, history_projection_version: input.history_projection_version }).onConflictDoNothing({ target: message.id }).returning({ id: message.id });
    if (inserted.length) {
      await this.transaction.update(thread).set({ updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(thread.id, input.thread_id), this.owned()));
      if (input.role === "assistant" && input.history_projection_version === 1
        && input.metadata?.turnStatus === "completed" && typeof input.metadata.turnId === "string"
        && await hasSchemaCapability(this.transaction, taskResultCapability)) {
        await new TaskSessionResultRepository(this.transaction).commit({ target_thread_id: input.thread_id,
          target_turn_id: input.metadata.turnId, target_final_message_id: input.message_id }, this.canonicalUserId);
      }
      return input.message_id;
    }
    const rows = await this.transaction.select({ thread_id: message.thread_id, role: message.role, parts: message.parts, metadata: message.metadata }).from(message).where(eq(message.id, input.message_id)).limit(1);
    const existing = rows[0];
    let exact = false;
    try {
      const storedParts: unknown = JSON.parse(existing?.parts ?? "null");
      const storedMetadata: unknown = existing?.metadata === null ? null : JSON.parse(existing?.metadata ?? "null");
      exact = !!existing && Array.isArray(storedParts) && (storedMetadata === null && existing.metadata === null || !!storedMetadata && typeof storedMetadata === "object" && !Array.isArray(storedMetadata)) && existing.thread_id === input.thread_id && existing.role === input.role && canonicalMessageJson(storedParts) === parts && (storedMetadata === null ? null : canonicalMessageJson(storedMetadata)) === metadata;
    } catch { /* corrupted envelope cannot be replayed */ }
    if (!exact) throw new AuthBoundaryError("CHAT_MESSAGE_IDENTITY_CONFLICT", 409);
    return input.message_id; // exact replay never touches Thread order or overwrites projections
  }
  // The atomic user-message Service owns the confirmation guard before this method.
  // Raw JSON is shape-checked only; canonical bytes never pass through JS Number.
  async persistUserMessageRaw(input:ConfirmationGuardInput,title:string):Promise<string>{
    let partsShape:unknown,metadataShape:unknown;
    try{partsShape=JSON.parse(input.parts_json);metadataShape=input.metadata_json===null?null:JSON.parse(input.metadata_json);}
    catch{throw new AuthBoundaryError("INPUT_INVALID",400);}
    if(!Array.isArray(partsShape)||(input.metadata_json!==null&&(!metadataShape||typeof metadataShape!=="object"||Array.isArray(metadataShape))))throw new AuthBoundaryError("INPUT_INVALID",400);
    await this.requireOwned(input.thread_id,true);
    const parts=(await canonicalBusinessJson(input.parts_json)).canonical_json;
    const metadata=input.metadata_json===null?null:(await canonicalBusinessJson(input.metadata_json)).canonical_json;
    const inserted=await this.transaction.insert(message).values({id:input.message_id,thread_id:input.thread_id,role:"user",parts,metadata,history_final_text:null,history_process_available:false,history_projection_version:null}).onConflictDoNothing({target:message.id}).returning({id:message.id});
    if(inserted.length){
      await this.transaction.update(thread).set({title:sql`CASE WHEN ${thread.title} IS NULL OR ${thread.title}='' THEN ${title} ELSE ${thread.title} END`,updated_at:sql`CURRENT_TIMESTAMP`}).where(and(eq(thread.id,input.thread_id),this.owned()));
      return input.message_id;
    }
    const existing=(await this.transaction.select({thread_id:message.thread_id,role:message.role,parts:message.parts,metadata:message.metadata}).from(message).where(eq(message.id,input.message_id)).limit(1))[0];
    let valid=false;
    try{const oldParts:unknown=JSON.parse(existing?.parts??"null"),oldMetadata:unknown=existing?.metadata===null?null:JSON.parse(existing?.metadata??"null");valid=!!existing&&existing.thread_id===input.thread_id&&existing.role==="user"&&Array.isArray(oldParts)&&(existing.metadata===null||!!oldMetadata&&typeof oldMetadata==="object"&&!Array.isArray(oldMetadata));}
    catch{/* Corrupted immutable records cannot be replayed. */}
    if(!valid||!existing)throw new AuthBoundaryError("CHAT_MESSAGE_IDENTITY_CONFLICT",409);
    const oldParts=(await canonicalBusinessJson(existing.parts!)).canonical_json;
    const oldMetadata=existing.metadata===null?null:(await canonicalBusinessJson(existing.metadata)).canonical_json;
    if(oldParts!==parts||oldMetadata!==metadata)throw new AuthBoundaryError("CHAT_MESSAGE_IDENTITY_CONFLICT",409);
    // Recover only a missing title left by the former split write. Exact replay
    // with an existing title never touches Thread ordering or stored projections.
    await this.transaction.update(thread).set({title,updated_at:sql`CURRENT_TIMESTAMP`}).where(and(eq(thread.id,input.thread_id),this.owned(),sql`(${thread.title} IS NULL OR ${thread.title}='') AND ${thread.title} IS DISTINCT FROM ${title}`));
    return input.message_id;
  }
  async messages(threadId: string) {
    await this.requireOwned(threadId);
    const rows = await this.transaction.select(fullMessageFields).from(message).where(eq(message.thread_id, threadId)).orderBy(sql`${message.created_at} ASC NULLS FIRST`, asc(message.id)); return rows.map(row => decodeChatMessage(row, "canonical"));
  }
  async page(input: z.infer<typeof messagePageInputDto>) {
    await this.requireOwned(input.thread_id);
    const base = eq(message.thread_id, input.thread_id), size = input.limit + 1;
    const select = (condition: ReturnType<typeof and>, limit: number) => this.transaction.select(pageMessageFields).from(message).where(condition).orderBy(...messageDescending).limit(limit);
    let rows: Awaited<ReturnType<typeof select>>;
    if (input.before === null) rows = await select(base, size);
    else if (input.before.created_at === null) rows = await select(and(base, isNull(message.created_at), lt(message.id, input.before.id)), size);
    else {
      // The tuple retains the composite index boundary. A separate NULL tail
      // avoids changing it into an OR filter over all newer indexed messages.
      rows = await select(and(base, sql`(${message.created_at}, ${message.id}) < (${input.before.created_at}::timestamptz, ${input.before.id})`), size);
      if (rows.length < size) rows.push(...await select(and(base, isNull(message.created_at)), size - rows.length));
    }
    return { messages: rows.slice(0, input.limit).reverse().map(row => decodeChatMessage(row, "final")), has_more: rows.length > input.limit, latest_message_id: input.before === null && rows.length ? rows[0].id : null };
  }
  async processDetail(threadId: string, messageId: string) {
    await this.requireOwned(threadId);
    const rows = await this.transaction.select(fullMessageFields).from(message).where(and(eq(message.thread_id, threadId), eq(message.id, messageId), eq(message.role, "assistant"), eq(message.history_projection_version, 1), eq(message.history_process_available, true))).limit(1); return rows[0] ? decodeChatMessage(rows[0], "canonical") : null;
  }
  async latest(threadId: string) {
    await this.requireOwned(threadId);
    const rows = await this.transaction.select({ id: message.id }).from(message).where(eq(message.thread_id, threadId)).orderBy(...messageDescending).limit(1); return rows[0]?.id ?? null;
  }

  async enqueueInput(input: z.infer<typeof queueEnqueueInputDto>) {
    await this.requireOwned(input.thread_id, true);
    const existingQueue = (await this.transaction.select({ ...queueFields, parts: message.parts }).from(inputQueue).innerJoin(message, eq(message.id, inputQueue.message_id)).where(eq(inputQueue.message_id, input.message_id)).limit(1))[0];
    if (existingQueue) {
      if (existingQueue.thread_id !== input.thread_id) throw new AuthBoundaryError("CHAT_MESSAGE_IDENTITY_CONFLICT", 409);
      await this.persistUserMessageRaw({ ...input, metadata_json: input.metadata_json ?? null }, input.title_candidate);
      return projectQueueEntry(existingQueue);
    }
    const existingMessage = (await this.transaction.select({ id: message.id }).from(message).where(eq(message.id, input.message_id)).limit(1))[0];
    if (existingMessage) throw new AuthBoundaryError("CHAT_MESSAGE_IDENTITY_CONFLICT", 409);
    await this.persistUserMessageRaw({ ...input, metadata_json: input.metadata_json ?? null }, input.title_candidate);
    const inserted = await this.transaction.insert(inputQueue).values({ message_id: input.message_id, thread_id: input.thread_id }).returning(queueFields);
    return projectQueueEntry({ ...inserted[0]!, parts: input.parts_json });
  }

  async listInputs(threadId: string) {
    await this.requireOwned(threadId);
    const rows = await this.transaction.select({ ...queueFields, parts: message.parts }).from(inputQueue).innerJoin(message, eq(message.id, inputQueue.message_id)).where(eq(inputQueue.thread_id, threadId)).orderBy(asc(inputQueue.queue_sequence));
    return rows.map(projectQueueEntry);
  }

  async transitionInput(input: z.infer<typeof queueTransitionInputDto>) {
    await this.requireOwned(input.thread_id, true);
    const current = (await this.transaction.select({ ...queueFields, parts: message.parts }).from(inputQueue).innerJoin(message, eq(message.id, inputQueue.message_id)).where(and(eq(inputQueue.message_id, input.message_id), eq(inputQueue.thread_id, input.thread_id))).limit(1))[0];
    if (!current) throw new AuthBoundaryError("CHAT_INPUT_NOT_FOUND", 404);
    if (current.revision !== input.expected_revision) throw new AuthBoundaryError("CHAT_INPUT_REVISION_CONFLICT", 409);
    const action = input.action;
    const allowed =
      action === "select" ? current.status === "queued" && input.dispatch_turn_id === null :
      action === "claim" ? (current.status === "queued" || current.status === "selected") && !!input.dispatch_turn_id :
      action === "cancel" ? (current.status === "queued" || current.status === "selected") && input.dispatch_turn_id === null :
      action === "fail" && current.status === "selected" ? input.dispatch_turn_id === null :
      ["consume", "fail", "mark_unknown"].includes(action) ? current.status === "dispatching" && !!current.dispatch_turn_id && current.dispatch_turn_id === input.dispatch_turn_id : false;
    if (!allowed) throw new AuthBoundaryError("CHAT_INPUT_STATE_CONFLICT", 409);
    if (action === "select") {
      const selected = await this.transaction.select({ id: inputQueue.message_id }).from(inputQueue).where(and(eq(inputQueue.thread_id, input.thread_id), eq(inputQueue.status, "selected"))).limit(1);
      if (selected.length) throw new AuthBoundaryError("CHAT_INPUT_SELECTION_CONFLICT", 409);
    }
    if (action === "claim") {
      const active = await this.transaction.select({ id: inputQueue.message_id }).from(inputQueue).where(and(eq(inputQueue.thread_id, input.thread_id), eq(inputQueue.status, "dispatching"))).limit(1);
      if (active.length) throw new AuthBoundaryError("CHAT_INPUT_DISPATCH_CONFLICT", 409);
      if (current.status === "queued") {
        const selected = await this.transaction.select({ id: inputQueue.message_id }).from(inputQueue).where(and(eq(inputQueue.thread_id, input.thread_id), eq(inputQueue.status, "selected"))).limit(1);
        if (selected.length) throw new AuthBoundaryError("CHAT_INPUT_SELECTION_CONFLICT", 409);
      }
    }
    const next = { select: "selected", claim: "dispatching", consume: "consumed", cancel: "cancelled", fail: "failed", mark_unknown: "state_unknown" } as const;
    const updated = await this.transaction.update(inputQueue).set({
      status: next[action], revision: current.revision + 1,
      dispatch_turn_id: action === "claim" ? input.dispatch_turn_id : current.dispatch_turn_id,
      updated_at: sql`CURRENT_TIMESTAMP`,
    }).where(and(eq(inputQueue.message_id, input.message_id), eq(inputQueue.revision, current.revision))).returning(queueFields);
    if (!updated[0]) throw new AuthBoundaryError("CHAT_INPUT_REVISION_CONFLICT", 409);
    return projectQueueEntry({ ...updated[0], parts: current.parts });
  }

  async createTaskSession(input: z.infer<typeof taskSessionCreateInputDto>, returnResult = false) {
    await this.requireOwned(input.source_thread_id, true);
    const resultSchemaReady = await hasSchemaCapability(this.transaction, taskResultCapability);
    if (returnResult && !resultSchemaReady) throw new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY");
    const replay = await this.transaction.select({
      id: taskSession.id, source_thread_id: taskSession.source_thread_id,
      thread_id: taskSession.thread_id, title: taskSession.title,
      initial_message_id: taskSession.initial_message_id,
      launch_status: taskSession.launch_status, launch_error_code: taskSession.launch_error_code,
      return_result: resultSchemaReady ? taskSession.return_result : sql<boolean>`false`,
      created_at: taskSession.created_at, parts: message.parts,
    }).from(taskSession).innerJoin(message, eq(message.id, taskSession.initial_message_id))
      .where(and(eq(taskSession.source_thread_id, input.source_thread_id), eq(taskSession.request_key, input.request_key), eq(taskSession.user_id, sql`${this.canonicalUserId}::bigint`))).limit(1);
    if (replay[0]) {
      const task = projectTaskSession(replay[0]);
      if (task.title !== input.title || task.initial_message !== input.initial_message || replay[0].return_result !== returnResult) throw new AuthBoundaryError("TASK_SESSION_IDENTITY_CONFLICT", 409);
      return task;
    }
    if (input.source_message_id !== null) {
      const source = (await this.transaction.select({ ...queueFields, parts: message.parts }).from(inputQueue)
        .innerJoin(message, eq(message.id, inputQueue.message_id))
        .where(and(eq(inputQueue.message_id, input.source_message_id), eq(inputQueue.thread_id, input.source_thread_id))).limit(1))[0];
      if (!source || source.status !== "queued" || source.revision !== input.expected_revision
        || projectQueueEntry(source).text !== input.initial_message) throw new AuthBoundaryError("CHAT_INPUT_STATE_CONFLICT", 409);
      const cancelled = await this.transaction.update(inputQueue).set({ status: "cancelled", revision: source.revision + 1, updated_at: sql`CURRENT_TIMESTAMP` })
        .where(and(eq(inputQueue.message_id, source.message_id), eq(inputQueue.revision, source.revision), eq(inputQueue.status, "queued")))
        .returning({ message_id: inputQueue.message_id });
      if (!cancelled[0]) throw new AuthBoundaryError("CHAT_INPUT_REVISION_CONFLICT", 409);
    }
    const sourceThread = (await this.transaction.select({ deck_id: thread.deck_id, voice_id: thread.voice_id }).from(thread)
      .where(and(eq(thread.id, input.source_thread_id), this.owned())).limit(1))[0];
    if (!sourceThread) throw new AuthBoundaryError("CHAT_THREAD_NOT_FOUND", 404);
    const target = await this.create({ deck_id: sourceThread.deck_id, voice_id: sourceThread.voice_id, title: input.title });
    const initialMessageId = randomUUID();
    await this.persistUserMessageRaw({
      thread_id: target.thread_id, message_id: initialMessageId,
      parts_json: JSON.stringify([{ type: "text", text: input.initial_message }]),
      metadata_json: target.deck_id || target.voice_id
        ? JSON.stringify({ deckId: target.deck_id, voiceId: target.voice_id }) : null,
    }, input.title);
    const id = randomUUID();
    const values = {
      id, user_id: sql`${this.canonicalUserId}::bigint`, source_thread_id: input.source_thread_id,
      thread_id: target.thread_id, request_key: input.request_key,
      initial_message_id: initialMessageId, title: input.title,
    };
    const row = resultSchemaReady
      ? (await this.transaction.insert(taskSession).values({ ...values, return_result: returnResult })
        .returning(taskSessionInsertFields))[0]!
      : (await this.transaction.insert(preResultTaskSession).values(values)
        .returning(preResultTaskSessionInsertFields))[0]!;
    return taskSessionDto.parse({ task_id: row.id, source_thread_id: row.source_thread_id, thread_id: row.thread_id,
      title: row.title, initial_message_id: row.initial_message_id,
      initial_message: input.initial_message, launch_status: row.launch_status,
      launch_error_code: row.launch_error_code, created_at: pgTimestampToIso(row.created_at) });
  }

  async getTaskSession(sourceThreadId: string, taskId: string) {
    await this.requireOwned(sourceThreadId);
    const row = (await this.transaction.select({
      id: taskSession.id, source_thread_id: taskSession.source_thread_id,
      thread_id: taskSession.thread_id, title: taskSession.title,
      initial_message_id: taskSession.initial_message_id,
      launch_status: taskSession.launch_status, launch_error_code: taskSession.launch_error_code,
      created_at: taskSession.created_at, parts: message.parts,
    }).from(taskSession).innerJoin(message, eq(message.id, taskSession.initial_message_id))
      .where(and(eq(taskSession.id, taskId), eq(taskSession.source_thread_id, sourceThreadId),
        eq(taskSession.user_id, sql`${this.canonicalUserId}::bigint`))).limit(1))[0];
    return row ? projectTaskSession(row) : null;
  }

  async listTaskSessionLinks(threadId: string) {
    await this.requireOwned(threadId);
    const scheduledLinksAvailable = await hasSchemaCapability(this.transaction, scheduledLinkLifecycleCapability);
    const ordinaryTaskSession = scheduledLinksAvailable
      ? notExists(this.transaction.select({ id: scheduledTrigger.id }).from(scheduledTrigger)
        .where(eq(scheduledTrigger.task_session_id, taskSession.id)))
      : undefined;
    const linkFields = {
      task_id: taskSession.id, source_thread_id: taskSession.source_thread_id,
      thread_id: taskSession.thread_id, title: taskSession.title,
      launch_status: taskSession.launch_status, launch_error_code: taskSession.launch_error_code,
      created_at: taskSession.created_at,
    };
    const [sourceRow, createdRows] = await Promise.all([
      this.transaction.select(linkFields).from(taskSession)
        .where(and(eq(taskSession.thread_id, threadId), eq(taskSession.user_id, sql`${this.canonicalUserId}::bigint`), ordinaryTaskSession))
        .orderBy(asc(taskSession.created_at)).limit(1),
      this.transaction.select(linkFields).from(taskSession)
        .where(and(eq(taskSession.source_thread_id, threadId), eq(taskSession.user_id, sql`${this.canonicalUserId}::bigint`), ordinaryTaskSession))
        .orderBy(asc(taskSession.created_at), asc(taskSession.id)),
    ]);
    let source = null;
    if (sourceRow[0]) {
      const sourceThread = await this.get(sourceRow[0].source_thread_id);
      if (!sourceThread) throw new AuthBoundaryError("TASK_SESSION_SOURCE_NOT_FOUND", 503);
      source = taskSessionSourceLinkDto.parse({
        ...sourceRow[0], created_at: pgTimestampToIso(sourceRow[0].created_at),
        source_title: sourceThread.title,
      });
    }
    return {
      source,
      created: createdRows.map(row => taskSessionLinkDto.parse({
        ...row, created_at: pgTimestampToIso(row.created_at),
      })),
    };
  }

  async transitionTaskLaunch(input: z.infer<typeof taskSessionLaunchInputDto>) {
    await this.requireOwned(input.source_thread_id, true);
    const task = await this.getTaskSession(input.source_thread_id, input.task_id);
    if (!task) throw new AuthBoundaryError("TASK_SESSION_NOT_FOUND", 404);
    const expected = input.action === "claim" ? "pending" : "starting";
    if (task.launch_status !== expected) return { task, changed: false };
    const next = input.action === "claim" ? "starting" : "failed";
    const updated = await this.transaction.update(taskSession).set({ launch_status: next, launch_error_code: input.error_code })
      .where(and(eq(taskSession.id, input.task_id), eq(taskSession.source_thread_id, input.source_thread_id), eq(taskSession.launch_status, expected)))
      .returning({ id: taskSession.id });
    if (!updated[0]) throw new AuthBoundaryError("TASK_SESSION_LAUNCH_CONFLICT", 409);
    return { task: { ...task, launch_status: next, launch_error_code: input.error_code }, changed: true };
  }
}

function projectTaskSession(row: { id: string; source_thread_id: string; thread_id: string; title: string; initial_message_id: string; launch_status: string; launch_error_code: string | null; created_at: string; parts: string }) {
  let initialMessage = "";
  try {
    const parts: unknown = JSON.parse(row.parts);
    if (Array.isArray(parts) && parts.length === 1 && parts[0]?.type === "text" && typeof parts[0].text === "string") initialMessage = parts[0].text;
  } catch { /* Invalid stored content fails DTO validation below. */ }
  if (!initialMessage.trim()) throw new AuthBoundaryError("TASK_SESSION_MESSAGE_INVALID", 503);
  return taskSessionDto.parse({ task_id: row.id, source_thread_id: row.source_thread_id, thread_id: row.thread_id,
    title: row.title, initial_message_id: row.initial_message_id,
    initial_message: initialMessage, launch_status: row.launch_status,
    launch_error_code: row.launch_error_code, created_at: pgTimestampToIso(row.created_at) });
}
