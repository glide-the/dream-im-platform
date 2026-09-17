// [Input] Exact original Run/Runtime receipt/Session facts through the injected production ORM boundary.
// [Output] Named command replay, state guards, complete binding validation and mutation ordering evidence.
// [Pos] Provider-free Workflow command verification; public PostgreSQL atomicity remains a separate stage.
// [Sync] 2026-09-15: deny caller readiness/state/actor overrides and preserve single-event CAS semantics.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ read: vi.fn(), clock: vi.fn(), readiness: vi.fn(), lockJson: vi.fn(), session: vi.fn(), activateSession: vi.fn(), advance: vi.fn(), append: vi.fn() }));
vi.mock("./workflowRunRepository", () => ({ WorkflowRunRepository: class { read = mocks.read; } }));
vi.mock("./workflowRunCommandRepository", () => ({ WorkflowRunCommandRepository: class { clock = mocks.clock; readiness = mocks.readiness; lockJson = mocks.lockJson; session = mocks.session; activateSession = mocks.activateSession; advance = mocks.advance; append = mocks.append; } }));
import { prepareWorkflowRunCommand } from "./workflowRunCommandService";
import { workflowRunCommandOperationContracts } from "./workflowRunCommandDto";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
import type { DataTransaction } from "./database";

const tx = {} as DataTransaction;
const current = { ...validWorkflowRun(), source_voice_thread_id: "thread" };
const actor = { principal: { subject: "auth-user", canonical_user_id: current.created_by, client_id: "browser", scopes: ["dream:write"], status: "active" as const }, threadScope: null as string | null };
const lookup = { workspace_id: current.workspace_id, workflow_run_id: current.workflow_run_id, reason_code: null };
const start = { ...lookup, runtime_load_receipt_id: "receipt", agent_session_id: `as_${"b".repeat(32)}` };
const fail = { ...lookup, failed_step: "step", error_code: "failure" };
const now = "2026-09-14T00:00:00.123457+00:00";
// The fixed production Python codec must compute this digest from raw lock
// bytes; 1.0 and the integer above JS precision cannot be silently re-encoded.
const lockJson = '{"big":9007199254740993,"number":1.0}';
const lockHash = `sha256:${createHash("sha256").update(lockJson).digest("hex")}`;
const receipt = { receipt_id: start.runtime_load_receipt_id, workflow_run_id: current.workflow_run_id, runtime_plugin_lock_id: current.runtime_plugin_lock_id,
  runtime_plugin_lock_digest: lockHash, required_entries_ready: 1, runtime_environment_id: "runtime-location", runtime_pool_id: "runtime-location",
  distribution_mode: "local_persistent", runtime_node_id: "node", artifact_set_hash: `sha256:${"f".repeat(64)}`, policy_revision: "revision", deployment_tier: "local" };
const session = { ...Object.fromEntries(Object.entries(receipt).filter(([key]) => !["receipt_id", "required_entries_ready"].includes(key))), runtime_load_receipt_id: receipt.receipt_id, status: "creating" };
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000");
  mocks.read.mockResolvedValue(current); mocks.clock.mockResolvedValue("2026-09-14 00:00:00.123457+00"); mocks.readiness.mockResolvedValue(receipt);
  mocks.lockJson.mockResolvedValue(lockJson); mocks.session.mockResolvedValue(session); mocks.activateSession.mockResolvedValue(true); mocks.advance.mockResolvedValue(true); mocks.append.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());
describe("narrow original Workflow Run commands", () => {
  it("locks the owned Run/workspace before verifying all start bindings and mutates Session/status/history in order", async () => {
    const advanced = { ...current, status: "running", status_version: 3, runtime_load_receipt_id: start.runtime_load_receipt_id, agent_session_id: start.agent_session_id, started_at: now };
    mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(advanced);
    const prepared = await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx);
    expect(prepared.threadScope).toBe("thread"); expect(prepared.runScope).toBe(current.workflow_run_id);
    expect(mocks.read).toHaveBeenCalledWith(current.created_by, start, true); expect(mocks.advance).not.toHaveBeenCalled();
    expect(await prepared.action()).toEqual({ run: advanced });
    expect(mocks.activateSession).toHaveBeenCalledWith(start.agent_session_id, now);
    expect(mocks.advance).toHaveBeenCalledWith(current, "running", now, { runtime_load_receipt_id: start.runtime_load_receipt_id, agent_session_id: start.agent_session_id, failed_step: null, error_code: null });
    expect(mocks.append).toHaveBeenCalledWith(expect.objectContaining({ transition_seq: 3, from_status: "queued", to_status: "running", actor_id: current.created_by, occurred_at: now }));
    expect(mocks.session.mock.invocationCallOrder[0]).toBeLessThan(mocks.activateSession.mock.invocationCallOrder[0]);
    expect(mocks.activateSession.mock.invocationCallOrder[0]).toBeLessThan(mocks.advance.mock.invocationCallOrder[0]);
    expect(mocks.advance.mock.invocationCallOrder[0]).toBeLessThan(mocks.append.mock.invocationCallOrder[0]);
  });
  it.each(["workflow-run.fail", "workflow-run.cancel"] as const)("performs %s with original frozen bindings and one terminal transition", async operation => {
    const input = operation === "workflow-run.fail" ? fail : lookup;
    const target = operation === "workflow-run.fail" ? "failed" : "cancelled";
    const advanced = { ...current, status: target, status_version: 3, failed_step: target === "failed" ? fail.failed_step : null, error_code: target === "failed" ? fail.error_code : null, completed_at: now };
    mocks.read.mockResolvedValueOnce(current).mockResolvedValueOnce(advanced);
    expect(await (await prepareWorkflowRunCommand(operation, input, actor, tx)).action()).toEqual({ run: advanced });
    expect(mocks.advance).toHaveBeenCalledWith(current, target, now, expect.objectContaining({ runtime_load_receipt_id: null, agent_session_id: null }));
    expect(mocks.append).toHaveBeenCalledTimes(1); expect(mocks.activateSession).not.toHaveBeenCalled(); expect(mocks.readiness).not.toHaveBeenCalled();
  });
  it("replays a matching current target without a new Session/status/event write", async () => {
    const running = { ...current, status: "running", runtime_load_receipt_id: start.runtime_load_receipt_id, agent_session_id: start.agent_session_id };
    mocks.read.mockResolvedValueOnce(running);
    expect(await (await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx)).action()).toEqual({ run: running });
    mocks.read.mockResolvedValueOnce(running);
    await expect((await prepareWorkflowRunCommand("workflow-run.start", { ...start, runtime_load_receipt_id: "other" }, actor, tx)).action()).rejects.toMatchObject({ code: "AGENT_SESSION_NOT_READY", status: 409 });
    const cancelled = { ...current, status: "cancelled", completed_at: now }; mocks.read.mockResolvedValueOnce(cancelled);
    expect(await (await prepareWorkflowRunCommand("workflow-run.cancel", { ...lookup, reason_code: "new-reason" }, actor, tx)).action()).toEqual({ run: cancelled });
    expect(mocks.readiness).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled(); expect(mocks.append).not.toHaveBeenCalled();
  });
  it("denies a different terminal target and start from every state other than queued", async () => {
    mocks.read.mockResolvedValueOnce({ ...current, status: "failed", failed_step: "step", error_code: "code", completed_at: now });
    await expect((await prepareWorkflowRunCommand("workflow-run.cancel", lookup, actor, tx)).action()).rejects.toMatchObject({ code: "ILLEGAL_RUN_TRANSITION", status: 409 });
    mocks.read.mockResolvedValueOnce({ ...current, status: "preflight" });
    await expect((await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx)).action()).rejects.toMatchObject({ code: "ILLEGAL_RUN_TRANSITION" });
    expect(mocks.advance).not.toHaveBeenCalled();
  });
  it.each(["workflow_run_id", "runtime_plugin_lock_id", "runtime_plugin_lock_digest", "required_entries_ready"])("rejects invalid persisted receipt %s before Session activation", async field => {
    mocks.readiness.mockResolvedValue({ ...receipt, [field]: field === "required_entries_ready" ? 0 : "mismatch" });
    await expect((await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx)).action()).rejects.toMatchObject({ code: "RUNTIME_LOAD_RECEIPT_NOT_READY", status: 409 });
    expect(mocks.activateSession).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled();
  });
  it.each(["runtime_environment_id", "runtime_pool_id", "distribution_mode", "runtime_node_id", "artifact_set_hash", "policy_revision", "deployment_tier", "workflow_run_id", "runtime_load_receipt_id", "runtime_plugin_lock_id", "runtime_plugin_lock_digest", "status"])("rejects mismatched persisted Session %s", async field => {
    mocks.session.mockResolvedValue({ ...session, [field]: "mismatch" });
    await expect((await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx)).action()).rejects.toMatchObject({ code: "AGENT_SESSION_NOT_READY", status: 409 });
    expect(mocks.activateSession).not.toHaveBeenCalled(); expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("fails closed for missing receipt/lock/Session and codec/config failure", async () => {
    mocks.readiness.mockResolvedValueOnce(null);
    await expect((await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx)).action()).rejects.toMatchObject({ code: "RUNTIME_LOAD_RECEIPT_NOT_READY" });
    mocks.lockJson.mockResolvedValueOnce(null);
    await expect((await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx)).action()).rejects.toMatchObject({ code: "RUNTIME_LOAD_RECEIPT_NOT_READY" });
    mocks.session.mockResolvedValueOnce(null);
    await expect((await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx)).action()).rejects.toMatchObject({ code: "AGENT_SESSION_NOT_READY" });
    vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "");
    await expect((await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx)).action()).rejects.toMatchObject({ status: 503 }); expect(mocks.advance).not.toHaveBeenCalled();
  });
  it("propagates Session/CAS/event failures so the enclosing production UOW rolls back", async () => {
    mocks.activateSession.mockResolvedValueOnce(false);
    await expect((await prepareWorkflowRunCommand("workflow-run.start", start, actor, tx)).action()).rejects.toMatchObject({ code: "AGENT_SESSION_NOT_READY" });
    expect(mocks.advance).not.toHaveBeenCalled();
    mocks.advance.mockResolvedValueOnce(false);
    await expect((await prepareWorkflowRunCommand("workflow-run.cancel", lookup, actor, tx)).action()).rejects.toMatchObject({ code: "ILLEGAL_RUN_TRANSITION" }); expect(mocks.append).not.toHaveBeenCalled();
    mocks.append.mockRejectedValueOnce(new Error("event-storage-failed"));
    await expect((await prepareWorkflowRunCommand("workflow-run.fail", fail, actor, tx)).action()).rejects.toThrow("event-storage-failed");
  });
  it("rejects actor/state/table/readiness selectors, missing failure fields and unauthorized entities", async () => {
    for (const key of ["actor_id", "user_id", "table", "to_status", "required_entries_ready", "normalized_result_ready", "review_items_approved"]) expect(workflowRunCommandOperationContracts["workflow-run.start"].input.safeParse({ ...start, [key]: "override" }).success).toBe(false);
    await expect(prepareWorkflowRunCommand("workflow-run.fail", { ...fail, failed_step: "" }, actor, tx)).rejects.toMatchObject({ status: 400 });
    await expect(prepareWorkflowRunCommand("workflow-run.cancel", lookup, { ...actor, principal: { ...actor.principal, scopes: [] } }, tx)).rejects.toMatchObject({ status: 403 });
    await expect(prepareWorkflowRunCommand("workflow-run.cancel", lookup, { ...actor, threadScope: "other" }, tx)).rejects.toMatchObject({ status: 403 });
    mocks.read.mockResolvedValueOnce(null); await expect(prepareWorkflowRunCommand("workflow-run.cancel", lookup, actor, tx)).rejects.toMatchObject({ status: 404 });
    expect(mocks.advance).not.toHaveBeenCalled();
  });
});
