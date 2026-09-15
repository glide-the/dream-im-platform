// [Input] Production strict DTO/service with injected typed repository and real Python memory inspection.
// [Output] Actor/scope/entity isolation, closed evidence input and original raw dictionary semantics.
// [Pos] Provider-free boundary tests; actual ORM/atomicity remains a separate public integration stage.
// [Sync] 2026-09-15: no duplicated business query/state machine; only dependency injection and public contracts.
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ construct: vi.fn(), list: vi.fn(), prepare: vi.fn(), runtimeRead: vi.fn(), replace: vi.fn(), analysisVoices: vi.fn(), memory: vi.fn() }));
vi.mock("./deckRuntimeDataRepository", () => ({ DeckRuntimeDataRepository: class { constructor(...args: unknown[]) { mocks.construct(...args); } list = mocks.list; prepare = mocks.prepare; runtimeRead = mocks.runtimeRead; replace = mocks.replace; analysisVoices = mocks.analysisVoices; memory = mocks.memory; } }));
vi.mock("./deckVoiceService", () => ({ configuredDeckVoicePolicy: () => ({}) }));
import { runDeckRuntimeDataOperation } from "./deckRuntimeDataService";
import { pluginRefsReplaceInputDto, pluginRefsPrepareInputDto, deckPluginInstallationDto } from "./deckRuntimeDataDto";
import { inspectMemoryConfig } from "./deckContentCanonical";
import type { DataTransaction } from "./database";
const tx = {} as DataTransaction;
const principal = { subject: "auth-subject", canonical_user_id: "9007199254740993", client_id: "dream-client", scopes: ["dream:read", "dream:write"], status: "active" as const };
const evidence = { plugin_installation_id: "install1", package_name: "package", marketplace: "marketplace", resolved_version: "1.0.0", artifact_digest: `sha256:${"a".repeat(64)}`, compatibility_json: "{}", enabled: true, order_index: 0 };
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ deck_id: "deck1", refs: [] }); mocks.prepare.mockResolvedValue({ installations: [] }); mocks.runtimeRead.mockResolvedValue({ deck_id: null, refs: [] }); mocks.replace.mockResolvedValue({ deck_id: "deck1", refs: [], changed: false }); mocks.analysisVoices.mockResolvedValue({ voices: [] }); mocks.memory.mockResolvedValue({ memory_workspace_config_json: '{"float":1.0,"big":9007199254740993}', repaired: false }); });
afterEach(() => vi.unstubAllEnvs());
describe("runtime data authority", () => {
  it.each(["deck-plugin-refs.list", "deck-plugin-refs.prepare", "deck-plugin-refs.replace", "voice-analysis.list"] as const)("refuses Thread delegation for actor-level operation %s before querying", async name => {
    const input = name === "voice-analysis.list" ? {} : name === "deck-plugin-refs.prepare" ? { deck_id: "deck1", installation_ids: [] } : name === "deck-plugin-refs.replace" ? { deck_id: "deck1", refs: [] } : { deck_id: "deck1" };
    await expect(runDeckRuntimeDataOperation(name, input, { principal, threadScope: "thread1" }, tx)).rejects.toMatchObject({ status: 403 }); expect(mocks.construct).not.toHaveBeenCalled();
  });
  it.each(["deck-plugin-refs.runtime-read", "voice-memory.resolve"] as const)("enforces the original Thread scope on %s", async name => {
    await expect(runDeckRuntimeDataOperation(name, { thread_id: "other" }, { principal, threadScope: "thread1" }, tx)).rejects.toMatchObject({ status: 403 }); expect(mocks.construct).not.toHaveBeenCalled();
    await runDeckRuntimeDataOperation(name, { thread_id: "thread1" }, { principal, threadScope: "thread1" }, tx); expect(mocks.construct).toHaveBeenCalledWith(tx, principal.canonical_user_id, expect.anything());
  });
  it("requires write authority for repair and rejects external actor/SQL selectors", async () => {
    await expect(runDeckRuntimeDataOperation("voice-memory.resolve", { thread_id: "thread1" }, { principal: { ...principal, scopes: ["dream:read"] }, threadScope: null }, tx)).rejects.toMatchObject({ status: 403 });
    await expect(runDeckRuntimeDataOperation("voice-memory.resolve", { thread_id: "thread1", user_id: "2" }, { principal, threadScope: null }, tx)).rejects.toMatchObject({ status: 400 });
    await expect(runDeckRuntimeDataOperation("voice-analysis.list", { sql: "anything" }, { principal, threadScope: null }, tx)).rejects.toMatchObject({ status: 400 }); expect(mocks.construct).not.toHaveBeenCalled();
  });
  it("returns the exact raw numeric dictionary without JavaScript re-encoding", async () => {
    expect(await runDeckRuntimeDataOperation("voice-memory.resolve", { thread_id: "thread1" }, { principal, threadScope: null }, tx)).toEqual({ memory_workspace_config_json: '{"float":1.0,"big":9007199254740993}', repaired: false });
  });
});
describe("closed installation evidence", () => {
  it("normalizes original Python whitespace and refuses duplicate normalized identities", () => {
    expect(pluginRefsPrepareInputDto.parse({ deck_id: "deck1", installation_ids: ["\u001cinstall1\u001c"] }).installation_ids).toEqual(["install1"]);
    expect(pluginRefsPrepareInputDto.safeParse({ deck_id: "deck1", installation_ids: ["install1", " install1 "] }).success).toBe(false);
    expect(pluginRefsReplaceInputDto.safeParse({ deck_id: "deck1", refs: [evidence, evidence] }).success).toBe(false);
  });
  it("refuses readiness/path/actor shortcuts and preserves PostgreSQL signed ordering", () => {
    expect(pluginRefsReplaceInputDto.safeParse({ deck_id: "deck1", refs: [{ ...evidence, verified: true }] }).success).toBe(false);
    expect(pluginRefsReplaceInputDto.safeParse({ deck_id: "deck1", refs: [{ ...evidence, artifact_path: "/caller/path" }] }).success).toBe(false);
    expect(pluginRefsReplaceInputDto.parse({ deck_id: "deck1", refs: [{ ...evidence, order_index: -2_147_483_648 }] }).refs[0].order_index).toBe(-2_147_483_648);
    expect(pluginRefsReplaceInputDto.safeParse({ deck_id: "deck1", refs: [{ ...evidence, order_index: 2_147_483_648 }] }).success).toBe(false);
    expect(deckPluginInstallationDto.safeParse({ ...evidence, secret: "caller" }).success).toBe(false);
  });
});
describe("real Python dictionary inspection", () => {
  it.each(['{}', '{"float":1.0,"big":9007199254740993}', '{"legacy":NaN}', '{"legacy":Infinity}'])("preserves original dictionary detection for raw %s", async raw => {
    vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000"); expect(await inspectMemoryConfig(raw)).toEqual({ is_object: true });
  });
  it.each([null, "", "[]", "null", '"text"', "false", "invalid-json"])("classifies non-dictionary memory for repair %s", async raw => {
    vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000"); expect(await inspectMemoryConfig(raw)).toEqual({ is_object: false });
  });
  it("fails closed when the helper has no explicit deadline", async () => {
    vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", undefined); await expect(inspectMemoryConfig("{}")).rejects.toMatchObject({ status: 503 });
  });
});
