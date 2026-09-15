// [Input] Closed Thread/message business operations, separate from ORM entities.
// [Output] Strict DTOs, exact timestamp/decimal identity projection and semantic message validation.
// [Pos] Primary-owned Admin Thread/message data contract; Dream keeps its public UI projection.
// [Sync] 2026-09-14: migrate immutable message persistence, owner-bound Thread operations and keyset history.
import { z } from "zod";
import { decimalIdDto, isoTimeDto } from "../auth/dto";
import { AuthBoundaryError } from "../auth/config";

const entityId = z.string().min(1);
const nullableText = z.string().nullable();
const metadataDto = z.record(z.string(), z.json()).nullable();
export const chatThreadDto = z.strictObject({
  id: entityId, user_id: decimalIdDto, title: nullableText, deck_id: nullableText,
  voice_id: nullableText, claude_session_id: nullableText, agent_contract_version: nullableText,
  created_at: isoTimeDto.nullable(), updated_at: isoTimeDto.nullable(),
});
export const chatThreadSummaryDto = chatThreadDto.omit({ user_id: true, claude_session_id: true, agent_contract_version: true });
export const chatMessageDto = z.strictObject({
  id: entityId, role: z.enum(["user", "assistant"]), parts: z.array(z.json()), metadata: metadataDto,
  metadata_decode_error: z.boolean(), created_at: isoTimeDto.nullable(),
  history_final_text: nullableText, history_process_available: z.boolean(), history_projection_version: z.literal(1).nullable(),
});
export type ChatThreadDto = z.infer<typeof chatThreadDto>;
export type ChatMessageDto = z.infer<typeof chatMessageDto>;
export const threadCreateInputDto = z.strictObject({ deck_id: nullableText, voice_id: nullableText, title: nullableText }).refine(v => v.voice_id === null || v.deck_id !== null);
export const threadIdInputDto = z.strictObject({ thread_id: entityId });
export const threadListInputDto = z.strictObject({ deck_id: nullableText, limit: z.number().int().positive().safe().nullable(), offset: z.number().int().nonnegative().safe() });
export const threadSearchInputDto = z.strictObject({ deck_id: nullableText });
export const threadBindDeckInputDto = z.strictObject({ thread_id: entityId, deck_id: entityId });
export const threadSelectVoiceInputDto = z.strictObject({ thread_id: entityId, deck_id: entityId, voice_id: entityId, expected_voice_id: nullableText });
export const threadTitleInputDto = z.strictObject({ thread_id: entityId, title: z.string() });
export const threadSessionInputDto = z.strictObject({ thread_id: entityId, claude_session_id: entityId, agent_contract_version: entityId });
export const messagePersistInputDto = z.strictObject({
  thread_id: entityId, message_id: entityId, role: z.enum(["user", "assistant"]), parts: z.array(z.json()), metadata: metadataDto,
  history_final_text: nullableText, history_process_available: z.boolean(), history_projection_version: z.literal(1).nullable(),
}).superRefine((v, ctx) => {
  if (!validFinalProjection({ role: v.role, parts: v.parts, metadata: v.metadata ?? null, history_final_text: v.history_final_text ?? null, history_process_available: v.history_process_available, history_projection_version: v.history_projection_version ?? null })) ctx.addIssue({ code: "custom", message: "Final projection must match completed canonical message data." });
});
export type MessagePersistInput = z.infer<typeof messagePersistInputDto>;
export const messagePageInputDto = z.strictObject({
  thread_id: entityId, limit: z.number().int().min(1).max(100),
  before: z.strictObject({ id: entityId, created_at: isoTimeDto.nullable() }).nullable(),
});
export const messageDetailInputDto = z.strictObject({ thread_id: entityId, message_id: entityId });
export const threadResultDto = z.strictObject({ thread: chatThreadDto.nullable() });
export const threadCreateResultDto = z.strictObject({ thread_id: entityId, deck_id: nullableText, voice_id: nullableText });
export const threadListResultDto = z.strictObject({ threads: z.array(chatThreadSummaryDto) });
export const threadSearchResultDto = z.strictObject({ threads: z.array(chatThreadSummaryDto.extend({ messages_text: z.string() })) });
export const changedResultDto = z.strictObject({ changed: z.boolean() });
export const messagePersistResultDto = z.strictObject({ message_id: entityId });
export const messageListResultDto = z.strictObject({ messages: z.array(chatMessageDto) });
export const messagePageResultDto = z.strictObject({ messages: z.array(chatMessageDto), has_more: z.boolean(), latest_message_id: entityId.nullable() });
export const messageDetailResultDto = z.strictObject({ message: chatMessageDto.nullable() });
export const latestMessageResultDto = z.strictObject({ message_id: entityId.nullable() });
export const chatThreadOperationContracts = {
  "chat-thread.create": { kind: "write", input: threadCreateInputDto, output: threadCreateResultDto },
  "chat-thread.get": { kind: "read", input: threadIdInputDto, output: threadResultDto },
  "chat-thread.list": { kind: "read", input: threadListInputDto, output: threadListResultDto },
  "chat-thread.search": { kind: "read", input: threadSearchInputDto, output: threadSearchResultDto },
  "chat-thread.delete": { kind: "write", input: threadIdInputDto, output: changedResultDto },
  "chat-thread.bind-deck": { kind: "write", input: threadBindDeckInputDto, output: changedResultDto },
  "chat-thread.select-voice": { kind: "write", input: threadSelectVoiceInputDto, output: changedResultDto },
  "chat-thread.update-title": { kind: "write", input: threadTitleInputDto, output: changedResultDto },
  "chat-thread.update-session": { kind: "write", input: threadSessionInputDto, output: changedResultDto },
  "chat-message.persist": { kind: "write", input: messagePersistInputDto, output: messagePersistResultDto },
  "chat-message.list": { kind: "read", input: threadIdInputDto, output: messageListResultDto },
  "chat-message.page": { kind: "read", input: messagePageInputDto, output: messagePageResultDto },
  "chat-message.process-detail": { kind: "read", input: messageDetailInputDto, output: messageDetailResultDto },
  "chat-message.latest": { kind: "read", input: threadIdInputDto, output: latestMessageResultDto },
} as const;
export type ChatThreadOperation = keyof typeof chatThreadOperationContracts;

export function canonicalMessageJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalMessageJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalMessageJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function validFinalProjection(v: { role: string; parts: unknown[]; metadata: Record<string, unknown> | null; history_final_text: string | null; history_process_available: boolean; history_projection_version: number | null }): boolean {
  if (v.history_projection_version === null) return v.history_final_text === null && v.history_process_available === false;
  if (v.history_projection_version !== 1 || v.role !== "assistant" || !v.history_final_text?.trim() || !v.metadata) return false;
  if (v.metadata.turnStatus !== "completed" || typeof v.metadata.turnId !== "string" || !v.metadata.turnId || !Number.isInteger(v.metadata.finalPartIndex)) return false;
  let lastProcess = -1;
  for (let i = 0; i < v.parts.length; i++) {
    const part = v.parts[i];
    if (!part || typeof part !== "object" || Array.isArray(part) || !("type" in part) || !["text", "reasoning", "tool-invocation"].includes(String(part.type))) return false;
    if (part.type === "reasoning" || part.type === "tool-invocation") lastProcess = i;
  }
  const finalIndex = lastProcess + 1;
  const final = v.parts[finalIndex];
  return v.parts.length - finalIndex === 1 && v.metadata.finalPartIndex === finalIndex && final !== null && typeof final === "object" && !Array.isArray(final) && "type" in final && final.type === "text" && "text" in final && final.text === v.history_final_text && v.history_process_available === (finalIndex > 0);
}

// PostgreSQL timestamp strings retain microseconds. JS Date conversion would
// lose cursor precision and can skip messages sharing the same millisecond.
export function pgTimestampToIso(value: string | null): string | null {
  if (value === null) return null;
  let normalized = value.replace(" ", "T");
  if (/[+-]\d{2}$/.test(normalized)) normalized += ":00";
  else normalized = normalized.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const parsed = isoTimeDto.safeParse(normalized);
  if (!parsed.success) throw new AuthBoundaryError("CHAT_STORED_TIME_INVALID");
  return parsed.data;
}
export type MessageRow = { id: string; role: string; parts: string | null; metadata: string | null; created_at: string | null; history_final_text?: string | null; history_process_available?: boolean; history_projection_version?: number | null };
export function decodeChatMessage(row: MessageRow, mode: "final" | "canonical" = "final"): ChatMessageDto {
  const projected = mode === "final" && row.role === "assistant" && row.history_projection_version === 1 && !!row.history_final_text?.trim() && typeof row.history_process_available === "boolean";
  let parts: z.infer<typeof chatMessageDto.shape.parts> = [];
  if (projected) parts = [{ type: "text", text: row.history_final_text! }];
  else { try { const parsed = chatMessageDto.shape.parts.safeParse(JSON.parse(row.parts || "[]")); if (parsed.success) parts = parsed.data; } catch { /* existing fail-closed empty parts */ } }
  let metadata: z.infer<typeof metadataDto> = null;
  let decodeError = false;
  if (row.metadata !== null) { try { const parsed = metadataDto.safeParse(JSON.parse(row.metadata)); if (!parsed.success || parsed.data === null) decodeError = true; else metadata = parsed.data; } catch { decodeError = true; } }
  return chatMessageDto.parse({ id: row.id, role: row.role, parts, metadata, metadata_decode_error: decodeError, created_at: pgTimestampToIso(row.created_at), history_final_text: row.history_final_text ?? null, history_process_available: row.history_process_available ?? false, history_projection_version: row.history_projection_version ?? null });
}
