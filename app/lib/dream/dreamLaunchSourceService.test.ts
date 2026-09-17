// [Input] Actual source service with fixed repository facts and rollback-capable injected UOW.
// [Output] Atomic source/result/audit, bounded replay, permission/content conflicts and untouched dispatch data.
// [Pos] Provider-free domain regression; SQL/role/concurrency/public acceptance remains separate.
// [Sync] 2026-09-15: cover fresh and already-dispatched source without sharing frozen operation dispatch.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
const mocks = vi.hoisted(() => ({ repo: Object.fromEntries(["lockSource", "requireScope", "existingMessage", "existingThread", "clock", "insertThread", "insertMessage"].map(name => [name, vi.fn()])), receipt: vi.fn() }));
vi.mock("./dreamLaunchSourceRepository", () => ({ DreamLaunchSourceRepository: class {
  constructor() { for (const [key, method] of Object.entries(mocks.repo)) Object.assign(this, { [key]: method }); }
} }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { execute = mocks.receipt; } }));
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
import type { DreamLaunchExistingMessage } from "./dreamLaunchSourceRepository";
import { ensureDreamLaunchSource } from "./dreamLaunchSourceService";
import { dreamLaunchSourceIdentity } from "./dreamLaunchSourceSemantics";
import { operationInputDigest } from "./receipts";
const canonical = "9007199254740993", clock = "2026-09-14T00:00:00.123456+00:00";
const input = { workspace_id: "workspace", deck_id: "deck", agent_id: "agent", goal: "目标😀", idempotency_key: "key:one" };
const actor = { principal: { subject: "subject", canonical_user_id: canonical, client_id: "browser", scopes: ["dream:write"], status: "active" as const }, threadScope: null, runScope: null };
type State = { thread: { user_id: string; deck_id: string; voice_id: string | null } | null; message: DreamLaunchExistingMessage | null;
  events: string[]; receipts: Record<string, { result: unknown; inputHash: string; thread: string }> };
let state: State, boundaries: string[];
async function execute(raw: unknown = input, requestId = "original", principal = actor) {
  const before = structuredClone(state);
  try {
    const result = await ensureDreamLaunchSource(raw, principal, "service", requestId, {} as DataTransaction); boundaries.push("commit"); return result;
  } catch (error) { state = before; boundaries.push("rollback"); throw error; }
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  state = { thread: null, message: null, events: [], receipts: {} }; boundaries = [];
  mocks.repo.existingThread.mockImplementation(() => structuredClone(state.thread));
  mocks.repo.existingMessage.mockImplementation(() => structuredClone(state.message));
  mocks.repo.clock.mockResolvedValue("2026-09-14 08:00:00.123456+08");
  mocks.repo.insertThread.mockImplementation((_id: string, _title: string, deck_id: string, voice_id: string | null) => {
    state.thread = { user_id: canonical, deck_id, voice_id }; state.events.push("thread");
  });
  mocks.repo.insertMessage.mockImplementation((_id: string, thread_id: string, _parts: string, metadata: string, created_at: string) => {
    state.message = { ...state.thread!, thread_id, role: "user", metadata, created_at }; state.events.push("message", "thread_time");
  });
  mocks.receipt.mockImplementation(async (_name: string, requestId: string, raw: unknown, output: z.ZodType, action: () => Promise<unknown>, thread: string) => {
    const prior = state.receipts[requestId], inputHash = operationInputDigest(raw);
    if (prior) { if (prior.inputHash !== inputHash || prior.thread !== thread) throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409); return output.parse(prior.result); }
    const result = output.parse(await action()); state.receipts[requestId] = { result, inputHash, thread }; state.events.push("receipt", "audit"); return result;
  });
});
afterEach(() => vi.unstubAllEnvs());
it("commits deterministic hidden Thread/message/time and scoped result/audit in one UOW", async () => {
  const result = await execute(), identity = await dreamLaunchSourceIdentity(canonical, input);
  expect(result.source).toEqual({ thread_id: identity.threadId, message_id: identity.messageId, message_time: clock, request_fingerprint: identity.requestFingerprint, created: true });
  expect(state.events).toEqual(["thread", "message", "thread_time", "receipt", "audit"]); expect(boundaries).toEqual(["commit"]);
  expect(state.receipts.original.thread).toBe(identity.threadId); expect(JSON.parse(state.message!.metadata!)).toMatchObject({ visibility: "system-hidden", actorId: canonical, workspaceId: input.workspace_id, dispatchStatus: "pending" });
  expect(state.message!.metadata).not.toContain("workflowRunId");
});
it.each(["insertThread", "insertMessage", "receipt"])("rolls back all source effects if %s fails", async name => {
  if (name === "receipt") {
    const implementation = mocks.receipt.getMockImplementation()!;
    mocks.receipt.mockImplementationOnce(async (...args) => { await implementation(...args); throw new Error("Injected audit failure"); });
  } else mocks.repo[name].mockRejectedValueOnce(new Error("Injected source write failure"));
  await expect(execute()).rejects.toThrow(/Injected/); expect(state).toEqual({ thread: null, message: null, events: [], receipts: {} }); expect(boundaries).toEqual(["rollback"]);
});
it("returns original created receipt and new-request replay false without touching dispatched metadata or ordering", async () => {
  const first = await execute(); state.events = [];
  const metadata = JSON.parse(state.message!.metadata!); metadata.workflowRunId = "run_existing"; metadata.dispatchStatus = "dispatched"; metadata.dreamContext = { retained: true };
  state.message!.metadata = JSON.stringify(metadata); const before = structuredClone(state.message);
  expect(await execute()).toEqual(first); expect(state.events).toEqual([]); expect(state.message).toEqual(before);
  expect((await execute(input, "new_request")).source).toEqual({ ...first.source, created: false });
  expect(state.events).toEqual(["receipt", "audit"]); expect(state.message).toEqual(before);
  expect(mocks.repo.insertMessage).toHaveBeenCalledTimes(1); expect(mocks.repo.clock).toHaveBeenCalledTimes(1);
});
it("reuses an existing scoped Thread and atomically inserts only its missing source message", async () => {
  state.thread = { user_id: canonical, deck_id: input.deck_id, voice_id: input.agent_id };
  expect((await execute()).source.created).toBe(true); expect(state.events).toEqual(["message", "thread_time", "receipt", "audit"]); expect(mocks.repo.insertThread).not.toHaveBeenCalled();
});
it.each(["user_id", "deck_id", "voice_id"])("rejects a deterministic backing Thread with conflicting %s", async field => {
  state.thread = { user_id: canonical, deck_id: input.deck_id, voice_id: input.agent_id, [field]: "foreign" };
  await expect(execute()).rejects.toMatchObject({ code: "DREAM_LAUNCH_SOURCE_PERMISSION_DENIED", status: 403 }); expect(state.events).toEqual([]);
});
it.each(["thread_id", "user_id", "role", "metadata"])("rejects existing hidden message with invalid %s authority", async field => {
  await execute(); state.events = []; Object.assign(state.message!, { [field]: field === "metadata" ? "{invalid" : "foreign" });
  await expect(execute(input, "new_request")).rejects.toMatchObject({ code: "DREAM_LAUNCH_SOURCE_PERMISSION_DENIED", status: 403 }); expect(state.events).toEqual([]);
});
it.each(["goal", "agent_id", "deck_id"])("rejects same business key with changed %s instead of replacing source", async field => {
  await execute(); state.events = [];
  await expect(execute({ ...input, [field]: "different" }, "new_request")).rejects.toMatchObject({ code: "DREAM_LAUNCH_IDEMPOTENCY_CONFLICT", status: 409 }); expect(state.events).toEqual([]);
});
it("fails closed before recovering a receipt if current scope is removed or hidden source is deleted", async () => {
  await execute(); state.events = [];
  mocks.repo.requireScope.mockRejectedValueOnce(new AuthBoundaryError("DECK_ACCESS_DENIED", 404));
  await expect(execute()).rejects.toMatchObject({ code: "DECK_ACCESS_DENIED", status: 404 }); expect(state.events).toEqual([]);
  state.message = null;
  await expect(execute()).rejects.toMatchObject({ code: "DREAM_LAUNCH_SOURCE_UNAVAILABLE", status: 503 }); expect(state.events).toEqual([]);
});
it("rejects missing scope and entity-grant selectors before source writes", async () => {
  await expect(execute(input, "x", { ...actor, principal: { ...actor.principal, scopes: ["dream:read"] } })).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
  await expect(execute(input, "x", { ...actor, threadScope: "thread" })).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
  await expect(execute(input, "x", { ...actor, runScope: "run" })).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
  expect(mocks.repo.requireScope).not.toHaveBeenCalled(); expect(state.events).toEqual([]);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual entire fresh/replayed ensure-source outputs, insert parameters and commit boundary", async () => {
  function original(results: unknown[], arguments_: Record<string, unknown>) {
    const child = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/dreamLaunchSourceOracle.py")],
      { env: process.env, encoding: "utf8", timeout: 10_000, input: JSON.stringify({ action: "ensure", results, arguments: arguments_, clock }) });
    expect((child.error as NodeJS.ErrnoException | undefined)?.code ?? null).toBeNull(); expect(child.status, "Actual original source must finish without exposing stderr/body").toBe(0);
    return JSON.parse(child.stdout);
  }
  const first = await execute(), args = { actor_id: canonical, workspace_id: input.workspace_id, deck_id: input.deck_id, agent_id: input.agent_id,
    goal: input.goal, idempotency_key: input.idempotency_key, request_fingerprint: first.source.request_fingerprint,
    thread_id: first.source.thread_id, message_id: first.source.message_id };
  const fresh = original([null, { id: input.deck_id }, null, null, null, null, null], args);
  expect(first).toEqual({ source: fresh.source });
  const threadArgs = mocks.repo.insertThread.mock.calls[0], messageArgs = mocks.repo.insertMessage.mock.calls[0];
  expect([threadArgs[0], canonical, ...threadArgs.slice(1)]).toEqual(fresh.parameters[4]);
  expect(messageArgs).toEqual(fresh.parameters[5]); expect([messageArgs[4], messageArgs[1]]).toEqual(fresh.parameters[6]);
  expect(boundaries).toEqual(["commit"]); expect(fresh.commits).toBe(1); expect(fresh.rollbacks).toBe(0);
  const metadata = JSON.parse(state.message!.metadata!); metadata.workflowRunId = "run_existing"; metadata.dispatchStatus = "dispatched";
  state.message!.metadata = JSON.stringify(metadata); const retained = structuredClone(state.message);
  const replay = original([null, { id: input.deck_id }, retained], args);
  expect(await execute(input, "new_request")).toEqual({ source: replay.source }); expect(state.message).toEqual(retained);
  expect(replay.parameters).toHaveLength(3); expect(replay.commits).toBe(1); expect(replay.rollbacks).toBe(0); expect(boundaries).toEqual(["commit", "commit"]);
});
