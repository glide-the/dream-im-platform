// [Input] Admin-authenticated canonical identity, typed DTOs and an existing Drizzle transaction.
// [Output] Owner-filtered Thread/message persistence with CAS, immutable replay and exact keyset order.
// [Pos] Primary-owned Admin Repository; no HTTP orchestration or independent transaction.
// [Sync] 2026-09-15: raw user-message/title aggregate and stored confirmation guard preserve current leases.
import { randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lt, sql } from "drizzle-orm";
import { chat_thread as thread, chat_message as message, decks, voices } from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { canonicalMessageJson, chatThreadDto, chatThreadSummaryDto, decodeChatMessage, pgTimestampToIso, messagePersistInputDto, type MessagePersistInput } from "./chatThreadDto";
import { z } from "zod";
import {canonicalBusinessJson} from "./deckContentCanonical";
import {guardPersistedDreamConfirmation,type ConfirmationGuardInput} from "./confirmationGuard";
import { messagePageInputDto, threadCreateInputDto, threadListInputDto, threadSelectVoiceInputDto } from "./chatThreadDto";

const threadFields = { id: thread.id, user_id: sql<string>`${thread.user_id}::text`, title: thread.title, deck_id: thread.deck_id, voice_id: thread.voice_id, claude_session_id: thread.claude_session_id, agent_contract_version: thread.agent_contract_version, created_at: thread.created_at, updated_at: thread.updated_at };
const summaryFields = { id: thread.id, title: thread.title, deck_id: thread.deck_id, voice_id: thread.voice_id, created_at: thread.created_at, updated_at: thread.updated_at };
const fullMessageFields = { id: message.id, role: message.role, parts: message.parts, metadata: message.metadata, created_at: message.created_at };
const pageMessageFields = { ...fullMessageFields,
  parts: sql<string | null>`CASE WHEN ${message.role} = 'assistant' AND ${message.history_projection_version} = 1 AND ${message.history_final_text} IS NOT NULL AND btrim(${message.history_final_text}) <> '' THEN NULL ELSE ${message.parts} END`,
  history_final_text: message.history_final_text, history_process_available: message.history_process_available, history_projection_version: message.history_projection_version,
};
const messageDescending = [sql`${message.created_at} DESC NULLS LAST`, sql`${message.id} DESC NULLS LAST`];
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
}
