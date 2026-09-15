// [Input] Injected real Session repository boundary and actual complete Editor state shapes.
// [Output] Exact owner/scope, missing/corrupt distinction, last-write and text/timestamp behavior.
// [Pos] Provider-free Editor/Session domain contract checks; no production fallback or database fixture.
// [Sync] 2026-09-15: cover Reflections metadata-only Session listing without expanding other Session actions.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ current: vi.fn(), replace: vi.fn(), save: vi.fn(), batch: vi.fn(), list: vi.fn(), delete: vi.fn(), owns: vi.fn(), ownerSeen: vi.fn() }));
vi.mock("./editorSessionRepository", () => ({ EditorSessionRepository: class { constructor(_tx: unknown, owner: string) { mocks.ownerSeen(owner); } current = mocks.current; replace = mocks.replace; save = mocks.save; batch = mocks.batch; list = mocks.list; delete = mocks.delete; ownsWritingThread = mocks.owns; } }));
import { runEditorSessionOperation, type EditorSessionActor } from "./editorSessionService";
import { editorStateDto } from "./editorSessionDto";
import type { DataTransaction } from "./database";
const tx = {} as DataTransaction;
const state = { id: "session1", cells: [{ id: "text1", type: "text" as const, content: "正文" }], commentors: [], tasks: [], weightPath: [], overlappedPhrases: [], notFoundPhrases: [] };
const row = () => ({ id: state.id, name: null, stateJson: JSON.stringify(state), labelsJson: null, createdAt: null, updatedAt: "2026-09-14 00:00:00.123456+00" });
const actor: EditorSessionActor = { principal: { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read", "dream:write", "editor:read", "editor:write"], status: "active" }, threadScope: null, editorSessionScope: null, delegationPurpose: null };
beforeEach(() => { vi.clearAllMocks(); mocks.current.mockResolvedValue(row()); mocks.replace.mockResolvedValue({ updatedAt: row().updatedAt }); mocks.save.mockResolvedValue(row()); mocks.list.mockResolvedValue([row()]); mocks.batch.mockResolvedValue([row()]); mocks.owns.mockResolvedValue(true); });
describe("Editor and Session domain contract", () => {
  it("preserves exact canonical identity, nulls and microsecond projection", async () => {
    expect(await runEditorSessionOperation("session.get", { session_id: state.id }, actor, tx)).toEqual({ session: { id: state.id, name: null, editor_state: state, labels: [], created_at: null, updated_at: "2026-09-14T00:00:00.123456+00:00" } });
    expect(mocks.ownerSeen).toHaveBeenCalledWith("9007199254740993");
  });
  it("distinguishes missing state from malformed stored state", async () => {
    mocks.current.mockResolvedValueOnce(null);
    expect(await runEditorSessionOperation("editor-state.load", { session_id: state.id }, actor, tx)).toEqual({ session_id: state.id, editor_state: null, updated_at: null });
    mocks.current.mockResolvedValueOnce({ ...row(), stateJson: "{" });
    await expect(runEditorSessionOperation("editor-state.load", { session_id: state.id }, actor, tx)).rejects.toMatchObject({ code: "EDITOR_STATE_INVALID", status: 503 });
  });
  it("keeps last-write replacement and denies disappeared or foreign Session save", async () => {
    const later = { ...state, cells: [{ ...state.cells[0], content: "后写" }] };
    await runEditorSessionOperation("editor-state.replace", { session_id: state.id, editor_state: state }, actor, tx);
    await runEditorSessionOperation("editor-state.replace", { session_id: state.id, editor_state: later }, actor, tx);
    expect(mocks.replace).toHaveBeenLastCalledWith(state.id, later);
    mocks.replace.mockResolvedValueOnce(null);
    await expect(runEditorSessionOperation("editor-state.replace", { session_id: state.id, editor_state: later }, actor, tx)).rejects.toMatchObject({ status: 404 });
    mocks.save.mockResolvedValueOnce(null);
    await expect(runEditorSessionOperation("session.save", { session_id: state.id, editor_state: state, name: null, labels: null, created_at: null }, actor, tx)).rejects.toMatchObject({ status: 404 });
  });
  it("denies exact Editor Session mismatch, insufficient scopes and server Thread grants", async () => {
    await expect(runEditorSessionOperation("editor-state.load", { session_id: "session2" }, { ...actor, threadScope: "thread1", editorSessionScope: state.id, delegationPurpose: "editor-stdio" }, tx)).rejects.toMatchObject({ status: 403 });
    await expect(runEditorSessionOperation("editor-state.load", { session_id: state.id }, { ...actor, principal: { ...actor.principal, scopes: ["dream:read"] } }, tx)).rejects.toMatchObject({ status: 403 });
    await expect(runEditorSessionOperation("session.list", { start_date: null, end_date: null, include_text: false }, { ...actor, threadScope: "thread1" }, tx)).rejects.toMatchObject({ status: 403 });
    expect(mocks.current).not.toHaveBeenCalled(); expect(mocks.list).not.toHaveBeenCalled();
  });
  it("lists canonical-owner Sessions only for the exact unbound server-persistence actor", async () => {
    const persistenceActor: EditorSessionActor = { ...actor, threadScope: "thread1", delegationPurpose: "server-persistence" };
    expect(await runEditorSessionOperation("session.list", { start_date: null, end_date: null, include_text: false }, persistenceActor, tx)).toMatchObject({ sessions: [{ id: state.id }] });
    expect(mocks.ownerSeen).toHaveBeenCalledExactlyOnceWith("9007199254740993");
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith(null, null);
    await expect(runEditorSessionOperation("session.list", { start_date: null, end_date: null, include_text: false }, { ...persistenceActor, editorSessionScope: state.id }, tx)).rejects.toMatchObject({ code: "DELEGATION_ENTITY_DENIED", status: 403 });
  });
  it("lists metadata only for a Reflections worker and rejects source text", async () => {
    const reflectionActor: EditorSessionActor = { ...actor, threadScope: "thread1", delegationPurpose: "reflections-worker" };
    expect(await runEditorSessionOperation("session.list", { start_date: null, end_date: null, include_text: false }, reflectionActor, tx)).toMatchObject({ sessions: [{ id: state.id, text: null }] });
    await expect(runEditorSessionOperation("session.list", { start_date: null, end_date: null, include_text: true }, reflectionActor, tx)).rejects.toMatchObject({ code: "DELEGATION_ENTITY_DENIED", status: 403 });
  });
  it.each([
    ["session.save", { session_id: state.id, editor_state: state, name: null, labels: null, created_at: null }],
    ["session.get", { session_id: state.id }],
    ["session.batch", { session_ids: [state.id] }],
    ["session.text-list", {}],
    ["session.delete", { session_id: state.id }],
  ] as const)("does not expand server-persistence authority to %s", async (name, input) => {
    await expect(runEditorSessionOperation(name, input, { ...actor, threadScope: "thread1", delegationPurpose: "server-persistence" }, tx)).rejects.toMatchObject({ code: "DELEGATION_ENTITY_DENIED", status: 403 });
  });
  it("checks state ID and owned Writing Thread before persistence", async () => {
    await expect(runEditorSessionOperation("editor-state.replace", { session_id: "session2", editor_state: state }, actor, tx)).rejects.toMatchObject({ code: "EDITOR_SESSION_MISMATCH", status: 400 });
    mocks.owns.mockResolvedValueOnce(false);
    await expect(runEditorSessionOperation("session.save", { session_id: state.id, editor_state: { ...state, writingThreadId: "other-user-thread" }, name: null, labels: null, created_at: null }, actor, tx)).rejects.toMatchObject({ status: 404 });
    expect(mocks.replace).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("keeps Unicode preview length and different legacy list/text-list whitespace rules", async () => {
    const cells = [{ id: "a", type: "text", content: "  " + "😀".repeat(31) + "  " }, { id: "b", type: "text", content: "  后文  " }];
    mocks.list.mockResolvedValue([{ ...row(), stateJson: JSON.stringify({ ...state, cells }) }]);
    expect(await runEditorSessionOperation("session.list", { start_date: null, end_date: null, include_text: true }, actor, tx)).toMatchObject({ sessions: [{ first_line: "😀".repeat(30), text: "😀".repeat(31) + "\n\n后文" }] });
    expect(await runEditorSessionOperation("session.text-list", {}, actor, tx)).toMatchObject({ sessions: [{ text: "😀".repeat(31) + "  \n\n  后文" }] });
  });
  it("accepts complete suggestion/widget state and rejects unrelated fields", () => {
    expect(editorStateDto.safeParse({ ...state, cells: [{ id: "widget1", type: "widget", widgetType: "chat", data: { messages: [] } }, { id: "suggestion1", type: "writing-suggestion", content: "建议", status: "failed", anchor: { textCellId: "text1", textSnapshot: "正文" }, createdAt: "2026-09-14T00:00:00Z", updatedAt: "2026-09-14T00:01:00Z", error: { code: "timeout", message: "失败", retryable: true } }] }).success).toBe(true);
    expect(editorStateDto.safeParse({ ...state, user_id: "other" }).success).toBe(false);
  });
});
