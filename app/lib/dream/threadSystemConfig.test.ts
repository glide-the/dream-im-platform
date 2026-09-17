// [Input] Existing Thread owner protection, UserConfig raw-read and server-derived entity actors.
// [Output] Authorization/order/precision/fail-closed checks; public current-Run proof remains pending.
// [Pos] Unregistered domain validation, no database/receipt/runtime or source reimplementation.
// [Sync] 2026-09-15: allow matched persistence Thread without opening user config management.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DataTransaction } from "./database";
import { ChatThreadRepository } from "./chatThreadRepository";
import { UserSystemConfigRepository } from "./userSystemConfigRepository";
import { threadSystemConfigReadInputDto } from "./threadSystemConfigDto";
import { runThreadSystemConfigOperation, type ThreadSystemConfigActor } from "./threadSystemConfigService";
const actor: ThreadSystemConfigActor = { principal: { subject: "config-subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read"], status: "active" }, threadScope: null, runScope: null, editorSessionScope: null };
const tx = {} as DataTransaction, thread = "owned-thread";
afterEach(() => vi.restoreAllMocks());
describe("Thread configuration read authorization", () => {
  it.each(["user_id", "actor_id", "workflow_run_id", "editor_session_id", "sql", "table", "codec", "path"])("rejects caller selector %s", key => expect(threadSystemConfigReadInputDto.safeParse({ thread_id: thread, [key]: "caller" }).success).toBe(false));
  it.each([{ threadScope: null, runScope: null }, { threadScope: thread, runScope: null }, { threadScope: thread, runScope: "owned-run" }])("checks current Thread before config for %j", async scopes => {
    const events: string[] = [], canonicalActors: string[] = [], raw = '{"large":9007199254740993,"float":1.0,"negative":-0.0,"unknown":{"文字":"Ω"}}';
    const owner = vi.spyOn(ChatThreadRepository.prototype, "requireOwned").mockImplementation(async function (this: ChatThreadRepository) { events.push("owner"); canonicalActors.push(this.canonicalUserId); });
    vi.spyOn(UserSystemConfigRepository.prototype, "get").mockImplementation(async () => { events.push("config"); return { system_config_json: raw }; });
    const codec = vi.fn().mockImplementation(async () => { events.push("codec"); return { config_json: raw }; });
    expect(await runThreadSystemConfigOperation("thread-system-config.get", { thread_id: thread }, { ...actor, ...scopes }, tx, codec)).toEqual({ config_json: raw });
    expect(events).toEqual(["owner", "config", "codec"]);expect(owner).toHaveBeenCalledExactlyOnceWith(thread);expect(codec).toHaveBeenCalledExactlyOnceWith({ action: "read", stored_json: raw });
    expect(canonicalActors).toEqual([actor.principal.canonical_user_id]);
  });
  it.each([{ threadScope: "other-thread", runScope: null }, { threadScope: null, runScope: "run" }, { editorSessionScope: "editor" }])("rejects mismatched/inconsistent/Editor %j before any read", async scopes => {
    const owner = vi.spyOn(ChatThreadRepository.prototype, "requireOwned").mockResolvedValue(undefined), get = vi.spyOn(UserSystemConfigRepository.prototype, "get").mockResolvedValue(null);
    await expect(runThreadSystemConfigOperation("thread-system-config.get", { thread_id: thread }, { ...actor, ...scopes }, tx, async () => ({ config_json: "{}" }))).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });expect(owner).not.toHaveBeenCalled();expect(get).not.toHaveBeenCalled();
  });
  it("requires dream read scope before current Thread query", async () => {
    const owner = vi.spyOn(ChatThreadRepository.prototype, "requireOwned").mockResolvedValue(undefined);
    await expect(runThreadSystemConfigOperation("thread-system-config.get", { thread_id: thread }, { ...actor, principal: { ...actor.principal, scopes: ["editor:read"] } }, tx, async () => ({ config_json: "{}" }))).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });expect(owner).not.toHaveBeenCalled();
  });
  it("does not read config after current owner rejection", async () => {
    vi.spyOn(ChatThreadRepository.prototype, "requireOwned").mockRejectedValue(Object.assign(new Error("Missing owned Thread"), { code: "CHAT_THREAD_NOT_FOUND", status: 404 }));const get = vi.spyOn(UserSystemConfigRepository.prototype, "get").mockResolvedValue(null);
    await expect(runThreadSystemConfigOperation("thread-system-config.get", { thread_id: thread }, actor, tx, async () => ({ config_json: "{}" }))).rejects.toMatchObject({ code: "CHAT_THREAD_NOT_FOUND", status: 404 });expect(get).not.toHaveBeenCalled();
  });
  it("uses absent-data codec while propagating database failure", async () => {
    vi.spyOn(ChatThreadRepository.prototype, "requireOwned").mockResolvedValue(undefined);const get = vi.spyOn(UserSystemConfigRepository.prototype, "get").mockResolvedValue(null), codec = vi.fn().mockResolvedValue({ config_json: "{}" });
    expect(await runThreadSystemConfigOperation("thread-system-config.get", { thread_id: thread }, actor, tx, codec)).toEqual({ config_json: "{}" });expect(codec).toHaveBeenCalledExactlyOnceWith({ action: "read", stored_json: null });get.mockRejectedValueOnce(new Error("Data service unavailable"));
    await expect(runThreadSystemConfigOperation("thread-system-config.get", { thread_id: thread }, actor, tx, codec)).rejects.toThrow("Data service unavailable");expect(codec).toHaveBeenCalledTimes(1);
  });
  it("propagates codec failure and rejects additional result fields", async () => {
    vi.spyOn(ChatThreadRepository.prototype, "requireOwned").mockResolvedValue(undefined);vi.spyOn(UserSystemConfigRepository.prototype, "get").mockResolvedValue({ system_config_json: "broken" });
    await expect(runThreadSystemConfigOperation("thread-system-config.get", { thread_id: thread }, actor, tx, async () => { throw new Error("Invalid stored object"); })).rejects.toThrow("Invalid stored object");
    await expect(runThreadSystemConfigOperation("thread-system-config.get", { thread_id: thread }, actor, tx, async () => ({ config_json: "{}", caller: true }))).rejects.toMatchObject({ code: "USER_SYSTEM_CONFIG_DATA_INVALID" });
  });
});
