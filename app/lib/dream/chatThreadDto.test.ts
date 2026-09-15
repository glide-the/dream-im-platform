// [Input] Legacy immutable envelope/projection and exact timestamp/identity requirements.
// [Output] Provider-free strict DTO, malformed-data and precision regression evidence.
// [Pos] Primary-owned deterministic Thread/message contract tests.
// [Sync] 2026-09-14: protect original CAS JSON identity, final projection and microsecond/null semantics.
import { describe, expect, it } from "vitest";
import { canonicalMessageJson, chatThreadDto, decodeChatMessage, messagePersistInputDto, messagePageInputDto, pgTimestampToIso, threadCreateInputDto } from "./chatThreadDto";
import { validateChatThreadActor } from "./chatThreadService";
import { principalDto } from "../auth/dto";
const projection = {
  thread_id: "thread-a", message_id: "message-a", role: "assistant",
  parts: [{ type: "reasoning", text: "process" }, { type: "text", text: "answer" }],
  metadata: { turnId: "turn-a", turnStatus: "completed", finalPartIndex: 1 },
  history_final_text: "answer", history_process_available: true, history_projection_version: 1,
};
const principal = principalDto.parse({ subject: "subject-a", canonical_user_id: "9007199254740993", client_id: "browser-a", scopes: ["dream:read", "dream:write"], status: "active" });
describe("Thread/message DTO compatibility", () => {
  it("canonicalizes semantic JSON replay independently of key order/whitespace", () => {
    expect(canonicalMessageJson(JSON.parse('{"b":2,"nested":{"z":1,"a":"你好"}}'))).toBe(canonicalMessageJson({ nested: { a: "你好", z: 1 }, b: 2 }));
    expect(canonicalMessageJson({ parts: ["one", "two"] })).not.toBe(canonicalMessageJson({ parts: ["two", "one"] }));
  });
  it("preserves canonical bigint strings beyond JS number precision", () => {
    const v = chatThreadDto.parse({ id: "thread-a", user_id: principal.canonical_user_id, title: null, deck_id: null, voice_id: null, claude_session_id: null, agent_contract_version: null, created_at: null, updated_at: null });
    expect(v.user_id).toBe("9007199254740993");
  });
  it("retains six-digit PostgreSQL timestamp precision and legacy NULL", () => {
    expect(pgTimestampToIso("2026-09-14 11:12:13.123456+00")).toBe("2026-09-14T11:12:13.123456+00:00");
    expect(pgTimestampToIso("2026-09-14 11:12:13.123457+0800")).toBe("2026-09-14T11:12:13.123457+08:00");
    expect(pgTimestampToIso(null)).toBeNull();
    expect(() => pgTimestampToIso("infinity")).toThrow("CHAT_STORED_TIME_INVALID");
  });
  it("validates the completed assistant projection against canonical parts", () => {
    expect(messagePersistInputDto.safeParse(projection).success).toBe(true);
    expect(messagePersistInputDto.safeParse({ ...projection, history_final_text: "different" }).success).toBe(false);
    expect(messagePersistInputDto.safeParse({ ...projection, history_process_available: false }).success).toBe(false);
    expect(messagePersistInputDto.safeParse({ ...projection, metadata: { ...projection.metadata, turnStatus: "cancelled" } }).success).toBe(false);
  });
  it("rejects ambiguous finals, incomplete projections and boolean final indexes", () => {
    expect(messagePersistInputDto.safeParse({ ...projection, parts: [...projection.parts, { type: "text", text: "extra" }] }).success).toBe(false);
    expect(messagePersistInputDto.safeParse({ ...projection, history_projection_version: null }).success).toBe(false);
    expect(messagePersistInputDto.safeParse({ ...projection, metadata: { ...projection.metadata, finalPartIndex: true } }).success).toBe(false);
    expect(messagePersistInputDto.safeParse({ ...projection, role: "user" }).success).toBe(false);
  });
  it("permits ordinary user envelopes without a projection and nullable metadata", () => {
    expect(messagePersistInputDto.safeParse({ ...projection, role: "user", metadata: null, history_final_text: null, history_process_available: false, history_projection_version: null }).success).toBe(true);
  });
  it("rejects externally supplied identity fields and voice without Deck", () => {
    expect(threadCreateInputDto.safeParse({ deck_id: null, voice_id: null, title: null, user_id: "1" }).success).toBe(false);
    expect(threadCreateInputDto.safeParse({ deck_id: null, voice_id: "voice-a", title: null }).success).toBe(false);
    expect(messagePersistInputDto.safeParse({ ...projection, actor_id: "1" }).success).toBe(false);
  });
  it("represents timestamp and NULL cursors explicitly and preserves existing page bounds", () => {
    expect(messagePageInputDto.safeParse({ thread_id: "thread-a", limit: 100, before: { id: "message-a", created_at: null } }).success).toBe(true);
    expect(messagePageInputDto.safeParse({ thread_id: "thread-a", limit: 1, before: { id: "message-a", created_at: "2026-09-14T11:12:13.123456Z" } }).success).toBe(true);
    expect(messagePageInputDto.safeParse({ thread_id: "thread-a", limit: 101, before: null }).success).toBe(false);
    expect(messagePageInputDto.safeParse({ thread_id: "thread-a", limit: 0, before: null }).success).toBe(false);
  });
  it("distinguishes SQL NULL metadata from corrupt JSON scalar/array/null", () => {
    const row = { id: "m", role: "user", parts: '[{"type":"text","text":"hello"}]', created_at: null };
    expect(decodeChatMessage({ ...row, metadata: null }).metadata_decode_error).toBe(false);
    for (const metadata of ["null", "[]", "1", "{bad"]) expect(decodeChatMessage({ ...row, metadata }).metadata_decode_error).toBe(true);
    expect(decodeChatMessage({ ...row, metadata: '{"turnId":"turn-a"}' }).metadata).toEqual({ turnId: "turn-a" });
  });
  it("uses final-only projection while retaining corrupt-envelope diagnostic", () => {
    const v = decodeChatMessage({ id: "m", role: "assistant", parts: null, metadata: "{bad", created_at: null, history_final_text: "answer", history_process_available: true, history_projection_version: 1 });
    expect(v.parts).toEqual([{ type: "text", text: "answer" }]);
    expect(v.metadata_decode_error).toBe(true);
    expect(decodeChatMessage({ id: "m", role: "user", parts: "{bad", metadata: null, created_at: null }).parts).toEqual([]);
  });
  it("canonical process decoding retains reasoning/tool parts even with projection metadata", () => {
    const row = { id: "m", role: "assistant", parts: JSON.stringify(projection.parts), metadata: JSON.stringify(projection.metadata), created_at: null, history_final_text: "answer", history_process_available: true, history_projection_version: 1 };
    expect(decodeChatMessage(row, "canonical").parts).toEqual(projection.parts);
    expect(decodeChatMessage(row, "final").parts).toEqual([{ type: "text", text: "answer" }]);
  });
  it("requires exact user scope and thread-bound runtime identity", () => {
    expect(validateChatThreadActor({ principal, threadScope: null }, "chat-thread.list", { deck_id: null, limit: null, offset: 0 }).canonical_user_id).toBe("9007199254740993");
    expect(() => validateChatThreadActor({ principal: { ...principal, scopes: ["dream:read"] }, threadScope: null }, "chat-message.persist", projection)).toThrow("DREAM_SCOPE_REQUIRED");
    expect(() => validateChatThreadActor({ principal, threadScope: "thread-b" }, "chat-message.persist", projection)).toThrow("DREAM_DELEGATION_ENTITY_DENIED");
    expect(() => validateChatThreadActor({ principal, threadScope: "thread-a" }, "chat-thread.list", {})).toThrow("DREAM_DELEGATION_ENTITY_DENIED");
    expect(() => validateChatThreadActor({ principal, threadScope: "thread-a" }, "chat-thread.delete", { thread_id: "thread-a" })).toThrow("DREAM_DELEGATION_SCOPE_REQUIRED");
  });
});
