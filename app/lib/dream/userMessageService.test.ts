// [Input] Verified user/entity actors, strict raw business JSON and injected shared repositories.
// [Output] Atomic owner-before-guard ordering, control preservation and ordinary title persistence.
// [Pos] Production user-turn composition tests; no DB fixtures or synthetic state machine.
// [Sync] 2026-09-15: preserve Unicode title boundaries and deny identity/table/Run overrides.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owned: vi.fn(), save: vi.fn(), guard: vi.fn() }));
vi.mock("./chatThreadRepository", () => ({ ChatThreadRepository: class { requireOwned = mocks.owned; persistUserMessageRaw = mocks.save; } }));
vi.mock("./confirmationGuard", () => ({ guardPersistedDreamConfirmation: mocks.guard }));
import { persistCanonicalUserMessage } from "./userMessageService";
import { userMessageInputDto } from "./userMessageDto";
import type { DataTransaction } from "./database";
const tx = {} as DataTransaction;
const actor = { principal: { subject: "auth-user", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const }, threadScope: null as string | null };
const input = { thread_id: "thread1", message_id: "message1", parts_json: '[{"type":"text","text":"hello"}]', metadata_json: null, title_candidate: " 😀云正文 " };
beforeEach(() => { vi.clearAllMocks(); mocks.owned.mockResolvedValue(undefined); mocks.guard.mockResolvedValue(false); mocks.save.mockResolvedValue(input.message_id); });
afterEach(() => vi.unstubAllEnvs());
describe("atomic canonical user message", () => {
  it("locks ownership before guard and reuses raw ordinary message persistence", async () => {
    vi.stubEnv("DREAM_CHAT_AUTO_TITLE_MAX_CHARACTERS", "2");
    expect(await persistCanonicalUserMessage(tx, actor, input)).toEqual({ message_id: input.message_id, confirmation_preserved: false });
    expect(mocks.owned).toHaveBeenCalledWith(input.thread_id, true); expect(mocks.guard).toHaveBeenCalledWith(tx, actor.principal.canonical_user_id, input);
    expect(mocks.owned.mock.invocationCallOrder[0]).toBeLessThan(mocks.guard.mock.invocationCallOrder[0]);
    expect(mocks.save).toHaveBeenCalledWith(input, "😀云");
  });
  it("skips all message/title writes for pre-persisted authoritative confirmation", async () => {
    mocks.guard.mockResolvedValue(true);
    expect(await persistCanonicalUserMessage(tx, actor, input)).toEqual({ message_id: input.message_id, confirmation_preserved: true }); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("preserves raw numeric lexemes and refuses caller identity/role/Run/table fields", async () => {
    const raw = { ...input, parts_json: '[{"type":"text","text":"x","number":1.0,"counter":9007199254740993}]' };
    await persistCanonicalUserMessage(tx, actor, raw); expect(mocks.save.mock.calls[0][0].parts_json).toBe(raw.parts_json);
    for (const key of ["user_id", "actor", "role", "run_id", "table"]) expect(userMessageInputDto.safeParse({ ...input, [key]: "override" }).success).toBe(false);
  });
  it("rejects scope/entity/owner/guard failures before ordinary save", async () => {
    await expect(persistCanonicalUserMessage(tx, { ...actor, threadScope: "other" }, input)).rejects.toMatchObject({ status: 403 });
    await expect(persistCanonicalUserMessage(tx, { ...actor, principal: { ...actor.principal, scopes: [] } }, input)).rejects.toMatchObject({ status: 403 });
    expect(mocks.owned).not.toHaveBeenCalled();
    mocks.owned.mockRejectedValueOnce({ status: 404 }); await expect(persistCanonicalUserMessage(tx, actor, input)).rejects.toMatchObject({ status: 404 });
    mocks.guard.mockRejectedValueOnce({ status: 409 }); await expect(persistCanonicalUserMessage(tx, actor, input)).rejects.toMatchObject({ status: 409 });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and invalid title policy", async () => {
    await expect(persistCanonicalUserMessage(tx, actor, { ...input, parts_json: "{}" })).rejects.toMatchObject({ status: 400 });
    await expect(persistCanonicalUserMessage(tx, actor, { ...input, metadata_json: "[]" })).rejects.toMatchObject({ status: 400 });
    vi.stubEnv("DREAM_CHAT_AUTO_TITLE_MAX_CHARACTERS", "0"); await expect(persistCanonicalUserMessage(tx, actor, input)).rejects.toMatchObject({ code: "CHAT_AUTO_TITLE_POLICY_INVALID" });
  });
});
