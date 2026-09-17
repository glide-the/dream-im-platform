// [Input] Original creation receipt and current owned Run/source facts with fixed repository collaborators.
// [Output] Bounded original create/retry recovery, absence and ownership/frozen/entity binding failures.
// [Pos] Provider-free receipt domain gate; no new token, creation, Runtime or database authority.
// [Sync] 2026-09-15: validate current authority independently of the original queued lifecycle result.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ find: vi.fn(), workspace: vi.fn(), read: vi.fn(), source: vi.fn() }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class { find = mocks.find; } }));
vi.mock("./workflowRunCreationRepository", () => ({ WorkflowRunCreationRepository: class { assertWorkspace = mocks.workspace; runs = { read: mocks.read }; source = mocks.source; } }));
import { readOriginalRunCreationReceipt } from "./workflowRunCreationService";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
import type { DataTransaction } from "./database";
import { AuthBoundaryError } from "../auth/config";
import type { WorkflowRunCreationOperation } from "./workflowRunCreationDto";
const run = validWorkflowRun(), principal = { subject: "subject", canonical_user_id: run.created_by, client_id: "browser", scopes: ["dream:write"], status: "active" as const };
function read(operation: WorkflowRunCreationOperation = "workflow-run.create", current = principal) { return readOriginalRunCreationReceipt({} as DataTransaction, "service", current, operation, "original"); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.find.mockResolvedValue({ inputSha256: "original-input", result: { run }, runScope: run.workflow_run_id, threadScope: null, editorSessionScope: null }); mocks.read.mockResolvedValue(run);
});
it.each(["workflow-run.create", "workflow-run.retry"] as const)("recovers complete original %s result with current workspace/Run owner", async operation => {
  expect(await read(operation)).toEqual({ status: "committed", operation, request_id: "original", result: { run } });
  expect(mocks.find).toHaveBeenCalledWith(operation, "original"); expect(mocks.workspace).toHaveBeenCalledOnce();
  expect(mocks.read).toHaveBeenCalledWith(principal.canonical_user_id, { workspace_id: run.workspace_id, workflow_run_id: run.workflow_run_id }, true); expect(mocks.source).not.toHaveBeenCalled();
});
it.each(["workflow-run.create", "workflow-run.retry"] as const)("returns explicit absent for another original %s request", async operation => {
  mocks.find.mockResolvedValue(null); expect(await read(operation)).toEqual({ status: "absent", operation, request_id: "original" }); expect(mocks.workspace).not.toHaveBeenCalled();
});
it("requires write scope and a closed operation name before lookup", async () => {
  await expect(read("workflow-run.create", { ...principal, scopes: ["dream:read"] })).rejects.toMatchObject({ code: "DREAM_SCOPE_REQUIRED", status: 403 });
  await expect(read("workflow-run.patch" as WorkflowRunCreationOperation)).rejects.toMatchObject({ code: "OPERATION_UNAVAILABLE", status: 404 }); expect(mocks.find).not.toHaveBeenCalled();
});
it.each(["runScope", "threadScope", "editorSessionScope"])("rejects stored receipt with forged %s binding", async field => {
  const row = await mocks.find(); mocks.find.mockResolvedValue({ ...row, [field]: "foreign" });
  await expect(read()).rejects.toMatchObject({ code: "WORKFLOW_RUN_DATA_INVALID", status: 503 });
});
it.each(["idempotency_key", "semantic_fingerprint", "retry_of_run_id", "workspace_id", "created_by", "runtime_plugin_lock_id"])("rejects changed current immutable %s fact", async field => {
  const changed = field === "semantic_fingerprint" ? `sha256:${"f".repeat(64)}` : field === "retry_of_run_id" ? `run_${"f".repeat(32)}` : "changed";
  mocks.read.mockResolvedValue({ ...run, [field]: changed }); await expect(read()).rejects.toMatchObject({ code: "WORKFLOW_RUN_DATA_INVALID", status: 503 });
});
it("rejects lost current workspace permission and preserves the original queued result after a legal terminal transition", async () => {
  mocks.workspace.mockRejectedValueOnce(new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403)); await expect(read()).rejects.toMatchObject({ code: "WORKFLOW_PERMISSION_DENIED", status: 403 });
  mocks.read.mockResolvedValue({ ...run, status: "cancelled", status_version: 3, completed_at: run.created_at });
  expect(await read()).toMatchObject({ result: { run } });
});
it("revalidates the actual owned source message/time before bounded recovery", async () => {
  const sourced = { ...run, source_voice_thread_id: "thread", source_message_id: "message", source_message_time: run.created_at };
  mocks.find.mockResolvedValue({ inputSha256: "original-input", result: { run: sourced }, runScope: run.workflow_run_id, threadScope: "thread", editorSessionScope: null }); mocks.read.mockResolvedValue(sourced);
  mocks.source.mockResolvedValue({ role: "user", created_at: "2026-09-14 08:00:00.123456+08", deck_id: "deck" });
  expect(await read()).toMatchObject({ result: { run: sourced } }); expect(mocks.source).toHaveBeenCalledWith("thread", "message");
  mocks.source.mockResolvedValue({ role: "assistant", created_at: run.created_at, deck_id: "deck" }); await expect(read()).rejects.toMatchObject({ code: "WORKFLOW_SOURCE_NOT_AUTHORIZED", status: 403 });
});
