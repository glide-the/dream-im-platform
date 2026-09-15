// [Input] Verified Run actors and stored full Run/history facts supplied to the production repository boundary.
// [Output] Owner/scope, exact timestamp, lifecycle corruption and ordered projection evidence.
// [Pos] Provider-free Workflow service verification; no SQL fixtures or private API.
// [Sync] 2026-09-15: cover successful reads/history and missing/forbidden/corrupt failure paths.
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), history: vi.fn() }));
vi.mock("./workflowRunRepository", () => ({ WorkflowRunRepository: class { read = mocks.read; history = mocks.history; } }));
import { readWorkflowRun } from "./workflowRunService";
import type { DataTransaction } from "./database";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
const actor = { principal: { subject: "auth-user", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read"], status: "active" as const }, threadScope: null as string | null };
const tx = {} as DataTransaction;
const input = { workspace_id: "workspace", workflow_run_id: validWorkflowRun().workflow_run_id };
beforeEach(() => { vi.clearAllMocks(); mocks.read.mockResolvedValue({ ...validWorkflowRun(), created_at: "2026-09-14 00:00:00.123456+00" }); mocks.history.mockResolvedValue([]); });
describe("authoritative Workflow Run reads", () => {
  it("projects every lifecycle field and exact stored decimal/time/NULL", async () => {
    const output = await readWorkflowRun("workflow-run.read", input, actor, tx);
    expect(output).toEqual({ run: validWorkflowRun() }); expect(mocks.read).toHaveBeenCalledWith(actor.principal.canonical_user_id, input); expect(mocks.history).not.toHaveBeenCalled();
  });
  it("normalizes original Run and history instants to UTC without losing microseconds", async () => {
    mocks.read.mockResolvedValue({ ...validWorkflowRun(), source_voice_thread_id: "source", source_message_id: "message", source_message_time: "2026-09-14 08:00:00.123456+08", created_at: "2026-09-14 08:00:00.123456+08" });
    expect((await readWorkflowRun("workflow-run.read", input, actor, tx) as { run: ReturnType<typeof validWorkflowRun> }).run).toMatchObject({ created_at: validWorkflowRun().created_at, source_message_time: validWorkflowRun().created_at });
    mocks.history.mockResolvedValue([{ transition_id: `wrt_${"e".repeat(32)}`, workflow_run_id: input.workflow_run_id, transition_seq: 1, from_status: null, to_status: "preflight", actor_id: actor.principal.canonical_user_id, reason_code: null, failed_step: null, error_code: null, occurred_at: "2026-09-14 08:00:00.123456+08" }]);
    expect(await readWorkflowRun("workflow-run.history", input, actor, tx)).toHaveProperty("transitions.0.occurred_at", validWorkflowRun().created_at);
  });
  it("requires an owned scoped Run before loading its ordered history", async () => {
    const transition = { transition_id: `wrt_${"e".repeat(32)}`, workflow_run_id: input.workflow_run_id, transition_seq: 1, from_status: null, to_status: "preflight", actor_id: actor.principal.canonical_user_id, reason_code: null, failed_step: null, error_code: null, occurred_at: "2026-09-14 00:00:00.123456+00" };
    mocks.history.mockResolvedValue([transition]);
    expect(await readWorkflowRun("workflow-run.history", input, actor, tx)).toEqual({ transitions: [{ ...transition, occurred_at: validWorkflowRun().created_at }] });
    expect(mocks.read.mock.invocationCallOrder[0]).toBeLessThan(mocks.history.mock.invocationCallOrder[0]);
  });
  it("keeps missing/owner mismatch separate from stored lifecycle corruption", async () => {
    mocks.read.mockResolvedValueOnce(null); await expect(readWorkflowRun("workflow-run.read", input, actor, tx)).rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_FOUND", status: 404 });
    mocks.read.mockResolvedValueOnce({ ...validWorkflowRun(), created_by: "42" }); await expect(readWorkflowRun("workflow-run.history", input, actor, tx)).rejects.toMatchObject({ status: 404 });
    mocks.read.mockResolvedValueOnce({ ...validWorkflowRun(), status: "running" }); await expect(readWorkflowRun("workflow-run.read", input, actor, tx)).rejects.toMatchObject({ code: "WORKFLOW_RUN_DATA_INVALID", status: 503 });
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("accepts only the existing grant's source Thread and required scope", async () => {
    mocks.read.mockResolvedValue({ ...validWorkflowRun(), source_voice_thread_id: "bound-thread" });
    await expect(readWorkflowRun("workflow-run.read", input, { ...actor, threadScope: "other-thread" }, tx)).rejects.toMatchObject({ status: 403 });
    expect(await readWorkflowRun("workflow-run.read", input, { ...actor, threadScope: "bound-thread" }, tx)).toHaveProperty("run.source_voice_thread_id", "bound-thread");
    mocks.read.mockClear(); await expect(readWorkflowRun("workflow-run.read", input, { ...actor, principal: { ...actor.principal, scopes: [] } }, tx)).rejects.toMatchObject({ status: 403 }); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("fails closed for corrupt history, unrelated history rows and invalid lookup selectors", async () => {
    mocks.history.mockResolvedValue([{ transition_id: "invalid" }]); await expect(readWorkflowRun("workflow-run.history", input, actor, tx)).rejects.toMatchObject({ code: "WORKFLOW_RUN_DATA_INVALID" });
    await expect(readWorkflowRun("workflow-run.read", { ...input, actor_id: "override" }, actor, tx)).rejects.toMatchObject({ status: 400 });
    mocks.read.mockResolvedValue({ ...validWorkflowRun(), created_at: "infinity" }); await expect(readWorkflowRun("workflow-run.read", input, actor, tx)).rejects.toMatchObject({ code: "WORKFLOW_RUN_DATA_INVALID" });
  });
});
