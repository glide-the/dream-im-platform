// [Input] Actual dispatch service/codec and fixed owned Run/source facts in rollback-capable injected UOWs.
// [Output] Separate claim/finish commits, current-lease replay, no-op states and full actual dispatcher parity.
// [Pos] Provider-free domain gate; public SQL/concurrency/permissions remain separate acceptance.
// [Sync] 2026-09-15: preserve original canonical unknown numeric fields and commit-before-Runtime contract.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { z } from "zod";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
const mocks = vi.hoisted(() => ({ repo: Object.fromEntries(["run", "binding", "source", "clock", "claim", "finish"].map(name => [name, vi.fn()])), workspace: vi.fn(), receipt: vi.fn() }));
vi.mock("./dreamLaunchDispatchRepository", () => ({ DreamLaunchDispatchRepository: class {
  constructor() { for (const [key, method] of Object.entries(mocks.repo)) Object.assign(this, { [key]: method }); }
} }));
vi.mock("./workflowRunCreationRepository", () => ({ WorkflowRunCreationRepository: class { assertWorkspace = mocks.workspace; } }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { execute = mocks.receipt; } }));
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
import { operationInputDigest } from "./receipts";
import { dreamLaunchSourceEnvelope, dreamLaunchSourceIdentity } from "./dreamLaunchSourceSemantics";
import { canonicalBusinessJson } from "./deckContentCanonical";
import { executeDreamLaunchDispatch } from "./dreamLaunchDispatchService";
import type { DreamLaunchDispatchOperation } from "./dreamLaunchDispatchDto";
const canonical = "9007199254740993", clock = "2026-09-14T00:00:00.123456+00:00";
const command = { workspace_id: "workspace", deck_id: "deck", agent_id: "agent", goal: "目标😀", idempotency_key: "launch:one" };
const actor = { principal: { subject: "subject", canonical_user_id: canonical, client_id: "browser", scopes: ["dream:write"], status: "active" as const }, threadScope: null, runScope: null };
type State = { run: Record<string, unknown>; source: Record<string, unknown>; events: string[];
  receipts: Record<string, { hash: string; thread: string; run: string; result: unknown }> };
let state: State, boundaries: string[];
const input = () => ({ workspace_id: command.workspace_id, workflow_run_id: state.run.id, instruction_text: "Dream纯算法生成的完整指令😀" });
function oracle(input: unknown) {
  const child = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/dreamLaunchDispatchOracle.py")],
    { env: { PATH: process.env.PATH, INK_DREAM_SOURCE: process.env.INK_DREAM_SOURCE } as unknown as NodeJS.ProcessEnv, input: JSON.stringify(input), encoding: "utf8", timeout: 15000 });
  expect((child.error as NodeJS.ErrnoException | undefined)?.code ?? null).toBeNull(); expect(child.status, "Actual dispatcher must finish without exposing private stderr/body").toBe(0);
  return JSON.parse(child.stdout);
}
async function execute(operation: DreamLaunchDispatchOperation = "dream-launch-dispatch.claim", raw: unknown = input(), requestId = "original", principal = actor) {
  const before = structuredClone(state);
  try { const result = await executeDreamLaunchDispatch(operation, raw, principal, "service", requestId, {} as DataTransaction); boundaries.push("commit"); return result; }
  catch (error) { state = before; boundaries.push("rollback"); throw error; }
}
async function claimed(requestId = "original") {
  const result = await execute("dream-launch-dispatch.claim", input(), requestId);
  if (!("claimed" in result) || !result.claimed) throw new Error("Fixed source must claim"); return result;
}
beforeEach(async () => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000");
  const identity = await dreamLaunchSourceIdentity(canonical, command), full = validWorkflowRun();
  const { workflow_run_id: runId, ...fields } = full;
  state = { run: { ...fields, id: runId, created_by: canonical, workspace_id: command.workspace_id, idempotency_key: command.idempotency_key,
    source_voice_thread_id: identity.threadId, source_message_id: identity.messageId, source_message_time: clock,
    input_hash: (await canonicalBusinessJson(JSON.stringify({ goal: command.goal }))).content_hash },
    source: { message_id: identity.messageId, thread_id: identity.threadId, role: "user", created_at: clock, user_id: canonical,
      deck_id: command.deck_id, agent_id: command.agent_id, parts: "[]",
      metadata: dreamLaunchSourceEnvelope(canonical, command, identity.requestFingerprint).metadata.replace(/}$/, ',"integer":9007199254740993,"float":1.0,"negative":-0.0}') },
    events: [], receipts: {} }; boundaries = [];
  mocks.repo.run.mockImplementation(() => structuredClone(state.run)); mocks.repo.source.mockImplementation(() => structuredClone(state.source));
  mocks.repo.binding.mockImplementation(() => ({ workspace_id: command.workspace_id, deck_id: command.deck_id,
    deck_plugin_id: state.run.deck_plugin_id, deck_plugin_version: state.run.deck_plugin_version, binding_revision: state.run.binding_revision }));
  mocks.repo.clock.mockResolvedValue(clock);
  mocks.repo.claim.mockImplementation((_message, _thread, parts, metadata) => { state.source.parts = parts; state.source.metadata = metadata; state.events.push("claim"); });
  mocks.repo.finish.mockImplementation((_message, _thread, metadata) => { state.source.metadata = metadata; state.events.push("finish"); });
  mocks.receipt.mockImplementation(async (name: string, id: string, input: unknown, output: z.ZodType, action: () => Promise<unknown>, thread: string, _editor: null, run: string) => {
    const key = `${name}/${id}`, hash = operationInputDigest(input), prior = state.receipts[key];
    if (prior) { if (prior.hash !== hash || prior.thread !== thread || prior.run !== run) throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409); return output.parse(prior.result); }
    const result = output.parse(await action()); state.receipts[key] = { hash, thread, run, result }; state.events.push("receipt", "audit"); return result;
  });
});
afterEach(() => vi.unstubAllEnvs());
it("commits only claim/message/result/audit and returns server-derived Runtime envelope preserving raw numeric metadata", async () => {
  const before = structuredClone(state.run), result = await claimed();
  expect(state.run).toEqual(before); expect(state.events).toEqual(["claim", "receipt", "audit"]); expect(boundaries).toEqual(["commit"]);
  expect(result.context).toMatchObject({ workflow_run_id: state.run.id, thread_id: state.source.thread_id, deck_id: command.deck_id, agent_id: command.agent_id });
  expect(state.source.metadata).toContain('"integer":9007199254740993'); expect(state.source.metadata).toContain('"float":1.0'); expect(state.source.metadata).toContain('"negative":-0.0');
  expect(result.metadata_json).toContain('"dispatchStatus":"dispatched"'); expect(result.metadata_json).not.toContain("dispatchClaimId");
  expect(state.source.metadata).toContain('"dispatchStatus":"dispatching"'); expect(JSON.parse(result.parts_json)).toEqual([{ type: "text", text: input().instruction_text }]);
  expect(mocks.repo.run.mock.calls.map(call => call.at(-1))).toEqual([false, true]);
});
it.each([true, false])("finishes accepted=%s in a separate committed UOW while keeping claim/Run provenance", async accepted => {
  const result = await claimed(); state.events = [];
  expect(await execute("dream-launch-dispatch.finish", { workspace_id: command.workspace_id, workflow_run_id: state.run.id, claim_id: result.claim_id, accepted }, "finish-original"))
    .toEqual({ finished: true, workflow_run_id: state.run.id, thread_id: state.source.thread_id, message_id: state.source.message_id });
  expect(boundaries).toEqual(["commit", "commit"]); expect(state.events).toEqual(["finish", "receipt", "audit"]);
  expect(state.source.metadata).toContain(`"dispatchStatus":"${accepted ? "dispatched" : "pending"}"`); expect(state.source.metadata).not.toContain("dispatchClaimId");
});
it.each(["dispatched", "dispatching"])("does not claim an already %s envelope or alter source parts", async status => {
  const first = await claimed();
  if (status === "dispatched") await execute("dream-launch-dispatch.finish", { workspace_id: command.workspace_id, workflow_run_id: state.run.id, claim_id: first.claim_id, accepted: true }, "finish");
  state.events = []; const source = structuredClone(state.source);
  expect(await execute("dream-launch-dispatch.claim", input(), "new-request")).toEqual({ claimed: false, workflow_run_id: state.run.id, thread_id: state.source.thread_id, message_id: state.source.message_id });
  expect(state.source).toEqual(source); expect(state.events).toEqual(["receipt", "audit"]); expect(mocks.repo.claim).toHaveBeenCalledTimes(1);
});
it("recovers exact original active claim without issuing another claim or mutating metadata", async () => {
  const first = await claimed(), before = structuredClone(state); expect(await claimed()).toEqual(first); expect(state).toEqual(before); expect(mocks.repo.claim).toHaveBeenCalledTimes(1);
});
it("rejects a stale original claim and permits a new request to replace only the expired claim", async () => {
  const first = await claimed(); mocks.repo.clock.mockResolvedValue("2026-09-14T00:05:00.123456+00:00");
  const before = structuredClone(state); await expect(claimed()).rejects.toMatchObject({ code: "DREAM_LAUNCH_CLAIM_STALE", status: 409 }); expect(state).toEqual(before);
  const next = await claimed("new-request"); expect(next.claim_id).not.toBe(first.claim_id); expect(mocks.repo.claim).toHaveBeenCalledTimes(2);
});
it("ignores a stale finisher without overwriting the current claim and keeps original finish result bounded", async () => {
  const first = await claimed(), source = structuredClone(state.source);
  expect(await execute("dream-launch-dispatch.finish", { workspace_id: command.workspace_id, workflow_run_id: state.run.id, claim_id: `dlc_${"f".repeat(32)}`, accepted: false }, "stale-finish"))
    .toMatchObject({ finished: false }); expect(state.source).toEqual(source); expect(mocks.repo.finish).not.toHaveBeenCalled();
  const finish = { workspace_id: command.workspace_id, workflow_run_id: state.run.id, claim_id: first.claim_id, accepted: true };
  const completed = await execute("dream-launch-dispatch.finish", finish, "finish"); expect(await execute("dream-launch-dispatch.finish", finish, "finish")).toEqual(completed);
  expect(mocks.repo.finish).toHaveBeenCalledTimes(1);
});
it.each(["claim", "finish", "receipt"])("rolls back the current UOW if %s fails while preserving an earlier committed claim", async stage => {
  if (stage === "finish") {
    const first = await claimed(), before = structuredClone(state); mocks.repo.finish.mockRejectedValueOnce(new Error("Injected finish"));
    await expect(execute("dream-launch-dispatch.finish", { workspace_id: command.workspace_id, workflow_run_id: state.run.id, claim_id: first.claim_id, accepted: true }, "finish"))
      .rejects.toThrow("Injected"); expect(state).toEqual(before); expect(boundaries).toEqual(["commit", "rollback"]); return;
  }
  const before = structuredClone(state);
  if (stage === "receipt") { const original = mocks.receipt.getMockImplementation()!; mocks.receipt.mockImplementationOnce(async (...args) => { await original(...args); throw new Error("Injected audit"); }); }
  else mocks.repo.claim.mockRejectedValueOnce(new Error("Injected claim"));
  await expect(claimed()).rejects.toThrow("Injected"); expect(state).toEqual(before); expect(boundaries).toEqual(["rollback"]);
});
it.each(["user_id", "role", "deck_id", "agent_id", "created_at"])("rejects invalid current source %s before any envelope effects", async field => {
  state.source[field] = field === "created_at" ? "2026-09-14T00:00:00.123455+00:00" : "foreign";
  await expect(claimed()).rejects.toMatchObject({ code: "DREAM_LAUNCH_DISPATCH_PERMISSION_DENIED", status: 403 }); expect(state.events).toEqual([]);
});
it("fails closed on removed workspace/Run or frozen binding before current receipt recovery", async () => {
  await claimed(); state.events = []; mocks.workspace.mockRejectedValueOnce(new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403));
  await expect(claimed()).rejects.toMatchObject({ status: 403 }); mocks.repo.run.mockResolvedValueOnce(null);
  await expect(claimed()).rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_FOUND", status: 404 }); mocks.repo.binding.mockResolvedValueOnce(null);
  await expect(claimed()).rejects.toMatchObject({ status: 403 }); expect(state.events).toEqual([]);
});
it.each(["requestFingerprint", "workflowRunId", "goal"])("rejects conflicting stored %s without rewriting hidden metadata", async field => {
  state.source.metadata = String(state.source.metadata).replace(/}$/, `,"${field}":"foreign"}`);
  await expect(claimed()).rejects.toMatchObject({ code: "DREAM_LAUNCH_IDEMPOTENCY_CONFLICT", status: 409 }); expect(state.events).toEqual([]);
});
it("rejects insufficient scopes, entity grants, actor/context/metadata/status patch and conflicting original instruction", async () => {
  await expect(execute(undefined, input(), "scope", { ...actor, principal: { ...actor.principal, scopes: ["dream:read"] } })).rejects.toMatchObject({ status: 403 });
  await expect(execute(undefined, input(), "entity", { ...actor, runScope: "run" })).rejects.toMatchObject({ status: 403 });
  for (const field of ["actor_id", "context", "metadata", "parts", "dispatch_status"]) await expect(execute(undefined, { ...input(), [field]: "caller" })).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
  expect(state.events).toEqual([]); await claimed(); const before = structuredClone(state);
  await expect(execute(undefined, { ...input(), instruction_text: "changed" })).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 }); expect(state).toEqual(before);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual original dispatch canonical parameters/context/turn and independent finish commits", async () => {
  const instruction = oracle({ action: "instruction", goal: command.goal }).instruction;
  const before = structuredClone(state.source), result = await execute("dream-launch-dispatch.claim", { ...input(), instruction_text: instruction });
  if (!("claimed" in result) || !result.claimed) throw new Error("Original fresh claim required");
  const original = oracle({ action: "dispatch", clock, uuid: result.claim_id.slice(4), actor: canonical, goal: command.goal, context: result.context,
    source: { thread_id: before.thread_id, message_id: before.message_id, message_time: clock, request_fingerprint: JSON.parse(String(before.metadata)).requestFingerprint, created: true },
    results: [null, { ...before, user_id: canonical }, null, { system_prompt: "原Agent完整prompt😀" }] });
  expect(original.accepted).toBe(true); expect(original.parameters[2]).toEqual([state.source.parts, state.source.metadata, state.source.message_id]);
  expect(original.turns[0]).toEqual({ actor_id: canonical, thread_id: state.source.thread_id, message_id: state.source.message_id,
    parts_json: result.parts_json, metadata_json: result.metadata_json, context: result.context, system_prompt: "原Agent完整prompt😀", resume: false });
  expect(original.events.indexOf("commit")).toBeLessThan(original.events.indexOf("turn")); expect([original.commits, original.rollbacks]).toEqual([1, 0]);
  const claimMetadata = state.source.metadata;
  const finished = await execute("dream-launch-dispatch.finish", { workspace_id: command.workspace_id, workflow_run_id: state.run.id, claim_id: result.claim_id, accepted: true }, "finish");
  const originalFinish = oracle({ action: "finish", clock, uuid: result.claim_id.slice(4), message_id: state.source.message_id, claim_id: result.claim_id,
    status: "dispatched", results: [null, { metadata: claimMetadata }, null] });
  expect(finished).toMatchObject({ finished: originalFinish.accepted }); expect(originalFinish.parameters[2]).toEqual([state.source.metadata, state.source.message_id]);
  expect([originalFinish.commits, originalFinish.rollbacks]).toEqual([1, 0]); expect(boundaries).toEqual(["commit", "commit"]);
});
