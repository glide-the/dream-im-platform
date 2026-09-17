// [Input] Original full failure completion and current owned failed Run/source facts.
// [Output] Historical recovery, immutable digest/scope checks and current permission failures.
// [Pos] Unregistered provider-free GET-domain gate; no public route, SQL, codec or metadata write.
// [Sync] 2026-09-15: validate the original error separately from later mutable dispatch metadata.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), workspace: vi.fn(), run: vi.fn(), source: vi.fn(), update: vi.fn() }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { find = mocks.find; } }));
vi.mock("./dreamLaunchFailureRepository", () => ({ DreamLaunchFailureRepository: class {
  ownedWorkspace = mocks.workspace; ownedRun = mocks.run; source = mocks.source; update = mocks.update;
} }));
import { operationInputDigest } from "./receipts";
import type { DataTransaction } from "./database";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
import { readOriginalDreamLaunchFailureReceipt } from "./dreamLaunchFailureOriginalReceiptService";
const base = validWorkflowRun(), { workflow_run_id: runId, ...fields } = base;
const input = { workspace_id: base.workspace_id, workflow_run_id: runId, error_code: " " };
const principal = { subject: "subject", canonical_user_id: base.created_by, client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const original = { updated: true, workflow_run_id: runId, thread_id: "thread", message_id: "message", error_code: input.error_code };
const raw = { ...fields, id: runId, status: "failed", failed_step: "dream_agent_dispatch", error_code: "LATER_RUN_ERROR", completed_at: base.created_at,
  source_voice_thread_id: "thread", source_message_id: "message", source_message_time: base.created_at };
const source = { message_id: "message", thread_id: "thread", user_id: base.created_by, role: "user", created_at: base.created_at,
  metadata: '{"dispatchStatus":"dispatching","dispatchClaimId":"later","dispatchErrorCode":"later"}', parts: "retained later parts" };
let prior: { result: unknown; inputSha256: string; threadScope: string | null; editorSessionScope: string | null; runScope: string | null };
const tx = {} as DataTransaction;
const read = (name = "dream-launch-failure.envelope", identity = principal) => readOriginalDreamLaunchFailureReceipt(tx, "service", identity, name, "original");
beforeEach(() => {
  vi.resetAllMocks(); prior = { result: structuredClone(original), inputSha256: operationInputDigest(input), threadScope: "thread", editorSessionScope: null, runScope: runId };
  mocks.find.mockImplementation(() => structuredClone(prior)); mocks.workspace.mockResolvedValue(base.workspace_id);
  mocks.run.mockResolvedValue(structuredClone(raw)); mocks.source.mockResolvedValue(structuredClone(source));
});
it("recovers every original field and truthy error without overwriting a later dispatch envelope", async () => {
  expect(await read()).toEqual({ status: "committed", operation: "dream-launch-failure.envelope", request_id: "original", result: original });
  expect(mocks.find).toHaveBeenCalledWith("dream-launch-failure.envelope", "original");
  expect(mocks.workspace).toHaveBeenCalledWith(base.created_by, runId); expect(mocks.run).toHaveBeenCalledWith(base.created_by, input);
  expect(mocks.source).toHaveBeenCalledWith("message", "thread"); expect(mocks.update).not.toHaveBeenCalled();
});
it("returns only explicit absent for an uncommitted or other-subject original without selecting business facts", async () => {
  mocks.find.mockResolvedValueOnce(null);
  expect(await read()).toEqual({ status: "absent", operation: "dream-launch-failure.envelope", request_id: "original" });
  expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled();
});
it.each(["threadScope", "editorSessionScope", "runScope"])("rejects the stored receipt's changed %s before reading business data", async field => {
  Object.assign(prior, { [field]: "other" }); await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
  expect(mocks.workspace).not.toHaveBeenCalled();
});
it.each(["digest", "error", "workspace"])("cannot recover a completion with changed original %s", async kind => {
  if (kind === "digest") prior.inputSha256 = "other";
  if (kind === "error") prior.result = { ...original, error_code: "changed" };
  if (kind === "workspace") mocks.workspace.mockResolvedValueOnce("changed");
  await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 }); expect(mocks.run).not.toHaveBeenCalled();
});
it("denies removed ownership and a removed Run before bounded recovery", async () => {
  mocks.workspace.mockResolvedValueOnce(null); await expect(read()).rejects.toMatchObject({ status: 403 });
  mocks.run.mockResolvedValueOnce(null); await expect(read()).rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_FOUND", status: 404 });
});
it("denies a now nonfailed Run without mutating it", async () => {
  mocks.run.mockResolvedValueOnce({ ...raw, status: "queued", failed_step: null, error_code: null, completed_at: null });
  await expect(read()).rejects.toMatchObject({ code: "DREAM_LAUNCH_FAILURE_NOT_READY", status: 409 }); expect(mocks.update).not.toHaveBeenCalled();
});
it.each(["user_id", "role", "message_id", "created_at"])("repeats current source %s authority before returning the old result", async field => {
  mocks.source.mockResolvedValueOnce({ ...source, [field]: field === "created_at" ? "2026-09-14T00:00:00.123455+00:00" : "other" });
  await expect(read()).rejects.toMatchObject({ code: "DREAM_LAUNCH_FAILURE_PERMISSION_DENIED", status: 403 });
});
it("rejects a bounded source tuple that no longer matches the owned Run", async () => {
  mocks.run.mockResolvedValueOnce({ ...raw, source_voice_thread_id: "changed" }); mocks.source.mockResolvedValueOnce(null);
  await expect(read()).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
});
it("does not recover updated=true for a deleted original source", async () => {
  mocks.source.mockResolvedValueOnce(null); await expect(read()).rejects.toMatchObject({ code: "DREAM_LAUNCH_FAILURE_SOURCE_UNAVAILABLE", status: 503 });
});
it("recovers a complete original updated=false no-op when the message is still missing", async () => {
  prior.result = { ...original, updated: false }; mocks.source.mockResolvedValueOnce(null);
  expect(await read()).toMatchObject({ status: "committed", result: { ...original, updated: false } }); expect(mocks.update).not.toHaveBeenCalled();
});
it("denies bad output, read-only identity and an unrelated operation", async () => {
  prior.result = { ...original, actor_id: "caller" }; await expect(read()).rejects.toMatchObject({ code: "DREAM_LAUNCH_FAILURE_RECEIPT_INVALID", status: 503 });
  mocks.find.mockClear(); await expect(read(undefined, { ...principal, scopes: ["dream:read"] })).rejects.toMatchObject({ status: 403 });
  await expect(read("dream-launch-failure.patch")).rejects.toMatchObject({ status: 404 }); expect(mocks.find).not.toHaveBeenCalled();
});
