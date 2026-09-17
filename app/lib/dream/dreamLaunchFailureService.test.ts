// [Input] Current owned failed Run/source and fixed mandatory production codec collaborator.
// [Output] Narrow envelope/result/audit UOW, bounded recovery and owner/entity/failure rejection.
// [Pos] Unregistered domain gate; original Run failure was committed before this independent UOW.
// [Sync] 2026-09-15: retain original error in bounded completion while reusing shared recovery facts.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({ ownedRun: vi.fn(), source: vi.fn(), update: vi.fn(), receipt: vi.fn() }));
vi.mock("./dreamLaunchFailureRepository", () => ({ DreamLaunchFailureRepository: class { ownedRun = mocks.ownedRun; source = mocks.source; update = mocks.update; } }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { execute = mocks.receipt; } }));
import { persistDreamLaunchFailureEnvelope, type DreamLaunchFailureOverlay } from "./dreamLaunchFailureService";
import { dreamLaunchFailureEnvelopeOutputDto } from "./dreamLaunchFailureDto";
import { operationInputDigest } from "./receipts";
import type { DataTransaction } from "./database";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
const current = validWorkflowRun(), input = { workspace_id: current.workspace_id, workflow_run_id: current.workflow_run_id, error_code: "AGENT_TERMINAL_ERROR" };
const actor = { principal: { subject: "subject", canonical_user_id: current.created_by, client_id: "browser", scopes: ["dream:write"], status: "active" as const }, threadScope: null as string | null, runScope: null as string | null };
const time = current.created_at, metadata = '{"integer":9007199254740993,"float":1.0,"negative":-0.0,"dispatchClaimId":"old","dispatchClaimedAt":"old","dispatchStatus":"dispatching"}';
const { workflow_run_id: id, ...fields } = current;
const raw = { ...fields, id, status: "failed", failed_step: "dream_agent_dispatch", error_code: input.error_code, completed_at: time,
  source_voice_thread_id: "thread", source_message_id: "message", source_message_time: time };
const source = { message_id: "message", thread_id: "thread", user_id: current.created_by, role: "user", created_at: time, metadata, parts: "retained original parts" };
type Receipt = { digest: string; scopes: unknown[]; result: unknown };
let state: { run: Record<string, unknown> | null; source: Record<string, unknown> | null; receipts: Map<string, Receipt>; events: string[] };
let fault: string | null;
const tx = {} as DataTransaction;
const overlay: DreamLaunchFailureOverlay = async (value, errorCode) => {
  if (fault === "codec") throw new Error("Injected codec fault");
  const child = spawnSync("python3", ["-I", "-S", "-B", resolve(process.cwd(), "app/lib/dream/dreamLaunchFailureEnvelope.py")],
    { env: { PATH: process.env.PATH } as unknown as NodeJS.ProcessEnv, encoding: "utf8", timeout: 10000, input: JSON.stringify({ metadata: value, error_code: errorCode }) });
  if (child.error || child.status !== 0) throw new Error("Fixed pure codec harness failed");
  return z.strictObject({ metadata_json: z.string() }).parse(JSON.parse(child.stdout));
};
async function execute(value: unknown = input, requestId = "original", auth = actor) {
  const before = structuredClone(state);
  try { return await persistDreamLaunchFailureEnvelope(value, auth, "service", requestId, tx, overlay); }
  catch (error) { state = before; throw error; }
}
beforeEach(() => {
  vi.resetAllMocks(); fault = null; state = { run: structuredClone(raw), source: structuredClone(source), receipts: new Map(), events: [] };
  mocks.ownedRun.mockImplementation(async () => state.run); mocks.source.mockImplementation(async () => state.source);
  mocks.update.mockImplementation(async (_message: string, _thread: string, encoded: string) => {
    if (fault === "update") throw new Error("Injected update fault"); state.source!.metadata = encoded; state.events.push("metadata");
  });
  mocks.receipt.mockImplementation(async (operation: string, requestId: string, value: unknown, output: z.ZodType, action: () => Promise<unknown>, ...scopes: unknown[]) => {
    const digest = operationInputDigest(value), key = `${operation}/${requestId}`, prior = state.receipts.get(key);
    if (prior) { if (prior.digest !== digest || JSON.stringify(prior.scopes) !== JSON.stringify(scopes)) throw new Error("Original request conflict"); return output.parse(prior.result); }
    const result = output.parse(await action()); if (fault === "receipt") throw new Error("Injected receipt fault");
    state.receipts.set(key, { digest, scopes, result }); state.events.push("receipt"); if (fault === "audit") throw new Error("Injected audit fault"); state.events.push("audit"); return result;
  });
});
it("writes only original failed envelope with one bounded receipt/audit after the Run's prior commit", async () => {
  const result = await execute(); expect(result).toEqual({ updated: true, workflow_run_id: id, thread_id: "thread", message_id: "message", error_code: input.error_code });
  expect(state.run).toEqual(raw); expect(state.source!.parts).toBe(source.parts); expect(state.source!.created_at).toBe(time);
  for (const text of ['"integer":9007199254740993', '"float":1.0', '"negative":-0.0', '"dispatchStatus":"failed"', `"dispatchErrorCode":"${input.error_code}"`]) expect(state.source!.metadata).toContain(text);
  expect(state.source!.metadata).not.toContain("dispatchClaim"); expect(state.events).toEqual(["metadata", "receipt", "audit"]);
  expect(mocks.receipt.mock.calls[0].slice(5)).toEqual(["thread", null, id]);
});
it("same original result remains bounded and cannot overwrite a subsequent envelope or change Run history", async () => {
  const result = await execute(); state.source!.metadata = '{"dispatchStatus":"dispatching","dispatchClaimId":"subsequent"}';
  const before = structuredClone(state); expect(await execute()).toEqual(result); expect(state).toEqual(before); expect(mocks.update).toHaveBeenCalledTimes(1);
  await expect(execute({ ...input, error_code: "different" })).rejects.toThrow("Original request conflict"); expect(state).toEqual(before);
});
it("accepts only the exact original Run and Thread persistence grant without activation authority", async () => {
  expect(await execute(input, "bound", { ...actor, threadScope: "thread", runScope: id })).toMatchObject({ updated: true });
  for (const auth of [{ ...actor, runScope: "different" }, { ...actor, threadScope: "different", runScope: id }, { ...actor, threadScope: "thread", runScope: null }])
    await expect(execute(input, "denied", auth)).rejects.toMatchObject({ code: "DELEGATION_ENTITY_DENIED", status: 403 });
});
it("rejects a current nonfailed Run before any metadata, receipt or audit", async () => {
  state.run = { ...raw, status: "queued", failed_step: null, error_code: null, completed_at: null }; const before = structuredClone(state);
  await expect(execute()).rejects.toMatchObject({ code: "DREAM_LAUNCH_FAILURE_NOT_READY", status: 409 }); expect(state).toEqual(before);
});
it("fails closed on removed Run/current workspace or mismatched canonical owner", async () => {
  state.run = null; await expect(execute()).rejects.toMatchObject({ status: 404 });
  state.run = { ...raw, created_by: "9007199254740995" }; await expect(execute()).rejects.toMatchObject({ status: 403 }); expect(state.events).toEqual([]);
  mocks.ownedRun.mockRejectedValueOnce(new Error("Removed workspace")); await expect(execute()).rejects.toThrow("Removed workspace"); expect(state.events).toEqual([]);
});
it.each(["user_id", "role", "message_id", "created_at"])("rejects current backing source %s before bounded recovery", async field => {
  await execute(); state.source![field] = field === "created_at" ? "2026-09-14T00:00:00.123455+00:00" : "other"; const before = structuredClone(state);
  await expect(execute()).rejects.toMatchObject({ code: "DREAM_LAUNCH_FAILURE_PERMISSION_DENIED", status: 403 }); expect(state).toEqual(before);
});
it.each(["codec", "update", "receipt", "audit"])("%s failure rolls back this independent UOW while retaining the already-failed Run", async stage => {
  fault = stage; const before = structuredClone(state); await expect(execute()).rejects.toThrow("Injected"); expect(state).toEqual(before); expect(state.run).toEqual(raw);
});
it("refuses to recover prior updated=true when its original source has been deleted", async () => {
  await execute(); state.source = null; const before = structuredClone(state);
  await expect(execute()).rejects.toMatchObject({ code: "DREAM_LAUNCH_FAILURE_SOURCE_UNAVAILABLE", status: 503 }); expect(state).toEqual(before);
});
it("missing message gives an explicit bounded no-op without touching the failed Run", async () => {
  state.source = null; expect(await execute()).toEqual({ updated: false, workflow_run_id: id, thread_id: "thread", message_id: "message", error_code: input.error_code });
  expect(state.run).toEqual(raw); expect(mocks.update).not.toHaveBeenCalled(); expect(state.events).toEqual(["receipt", "audit"]);
});
it("rejects insufficient write scope and actor/source/status/context/metadata selectors", async () => {
  await expect(execute(input, "scope", { ...actor, principal: { ...actor.principal, scopes: ["dream:read"] } })).rejects.toMatchObject({ status: 403 });
  for (const field of ["actor_id", "message_id", "thread_id", "status", "context", "metadata", "parts"])
    await expect(execute({ ...input, [field]: "caller" })).rejects.toMatchObject({ code: "INPUT_INVALID", status: 400 });
  await expect(execute({ ...input, error_code: "" })).rejects.toMatchObject({ status: 400 }); expect(mocks.ownedRun).not.toHaveBeenCalled(); expect(state.events).toEqual([]);
});
it("keeps original truthy whitespace error strings and closed output projection", async () => {
  expect(await execute({ ...input, error_code: " " })).toMatchObject({ updated: true }); expect(state.source!.metadata).toContain('"dispatchErrorCode":" "');
  expect(dreamLaunchFailureEnvelopeOutputDto.safeParse({ updated: true, workflow_run_id: id, thread_id: "thread", message_id: "message", metadata: "caller" }).success).toBe(false);
});
