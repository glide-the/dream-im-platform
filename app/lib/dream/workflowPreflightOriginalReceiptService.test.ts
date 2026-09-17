// [Input] Production original-request recovery with canonical/immutable association facts.
// [Output] Three-state evidence, exact encrypted replay and fail-closed owner/integrity rejection.
// [Pos] Provider-free recovery contract; source SQL/catalog/concurrency stays isolated public verification.
// [Sync] 2026-09-15: validate original request lock before association/receipt reads without resuming checks.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findRequest: vi.fn(), lock: vi.fn(), workspace: vi.fn(), read: vi.fn(), findReceipt: vi.fn() }));
vi.mock("./workflowPreflightExecutionRepository", async importOriginal => {
  const original = await importOriginal<typeof import("./workflowPreflightExecutionRepository")>();
  return { ...original, findOriginalPreflightRequest: mocks.findRequest, lockOriginalPreflightRequest: mocks.lock,
    WorkflowPreflightExecutionRepository: class { assertWorkspace = mocks.workspace; read = mocks.read; } };
});
vi.mock("./receipts", async importOriginal => ({ ...await importOriginal<typeof import("./receipts")>(), ReceiptRepository: class { find = mocks.findReceipt; } }));
import { AuthBoundaryError } from "../auth/config";
import { readOriginalPreflightReceipt } from "./workflowPreflightOriginalReceiptService";
import { WorkflowPreflightSecretReceipt } from "./workflowPreflightSecretReceipt";
import { validWorkflowPreflightRow } from "../../../tests/fixtures/workflowPreflight";
import { projectWorkflowTimestamp } from "./workflowRunService";
import type { DataTransaction } from "./database";
const row = validWorkflowPreflightRow(), tx = {} as DataTransaction;
const principal = { subject: "subject", canonical_user_id: row.created_by, client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const association = { workflowPreflightId: row.workflow_preflight_id, canonicalUserId: BigInt(row.created_by), workspaceId: "workspace", inputSha256: "a".repeat(64), executionOwner: true };
function original() {
  const { consumed_at: _consumed, clock: _clock, ...fields } = row;
  return { request_state: "committed" as const, preflight: { ...fields, status: "passed" as const, failed_check: null,
    expires_at: projectWorkflowTimestamp(row.expires_at)!, created_at: projectWorkflowTimestamp(row.created_at)!, preflight_token: "pft_original" } };
}
function stored() {
  return { inputSha256: association.inputSha256, threadScope: null, editorSessionScope: null, runScope: null,
    result: new WorkflowPreflightSecretReceipt().store({ service_client_id: "service", actor: principal.subject, operation: "workflow-preflight.execute",
      request_id: "original", input_sha256: association.inputSha256, workflow_preflight_id: row.workflow_preflight_id,
      canonical_user_id: row.created_by, workspace_id: "workspace" }, original()) };
}
function read() { return readOriginalPreflightReceipt(tx, "service", principal, "original"); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", "a".repeat(64));
  mocks.findRequest.mockResolvedValue(association); mocks.findReceipt.mockResolvedValue(null);
  mocks.read.mockResolvedValue({ ...row, status: "checking" });
});
afterEach(() => vi.unstubAllEnvs());
describe("original Preflight receipt evidence", () => {
  it("returns absent only after the original request lock and no durable request or receipt", async () => {
    mocks.findRequest.mockResolvedValue(null);
    expect(await read()).toEqual({ status: "absent", operation: "workflow-preflight.execute", request_id: "original" });
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(mocks.findRequest.mock.invocationCallOrder[0]);
    expect(mocks.findRequest).toHaveBeenCalledWith(tx, "service", principal.subject, "original"); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("returns committed checking-stage evidence without any token, mutation or resumed execution", async () => {
    const result = await read(); expect(result.status).toBe("in_progress");
    if (result.status !== "in_progress") throw new Error("Missing checking evidence");
    expect(result.result.request_state).toBe("in_progress"); expect(result.result.preflight.status).toBe("checking"); expect(result.result.preflight.preflight_token).toBeNull();
  });
  it("recovers exact original response after expiry without querying or changing its current lifecycle", async () => {
    mocks.findReceipt.mockResolvedValue(stored()); mocks.read.mockResolvedValue({ ...row, status: "expired" });
    expect(await read()).toEqual({ status: "committed", operation: "workflow-preflight.execute", request_id: "original", result: original() });
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.workspace).toHaveBeenCalledOnce();
  });
  it("denies canonical mismatch and current workspace ownership changes", async () => {
    mocks.findRequest.mockResolvedValueOnce({ ...association, canonicalUserId: 42n }); await expect(read()).rejects.toMatchObject({ status: 403 });
    mocks.workspace.mockRejectedValueOnce(new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403)); await expect(read()).rejects.toMatchObject({ status: 403 });
  });
  it("keeps impossible association/receipt/lifecycle states unavailable", async () => {
    mocks.findRequest.mockResolvedValueOnce(null); mocks.findReceipt.mockResolvedValueOnce(stored()); await expect(read()).rejects.toMatchObject({ code: "WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE" });
    mocks.findRequest.mockResolvedValueOnce({ ...association, executionOwner: false }); await expect(read()).rejects.toMatchObject({ status: 503 });
    mocks.read.mockResolvedValueOnce({ ...row, status: "passed" }); await expect(read()).rejects.toMatchObject({ status: 503 });
  });
  it("rejects mismatched stored digests/scopes and corrupted encrypted bindings", async () => {
    for (const change of [{ inputSha256: "b".repeat(64) }, { threadScope: "other" }, { editorSessionScope: "other" }, { runScope: "other" }]) {
      mocks.findReceipt.mockResolvedValueOnce({ ...stored(), ...change }); await expect(read()).rejects.toMatchObject({ status: 503 });
    }
    const receipt = stored(); mocks.findReceipt.mockResolvedValueOnce({ ...receipt, result: { ...receipt.result, ciphertext: "corrupt" } }); await expect(read()).rejects.toMatchObject({ status: 503 });
  });
  it("requires the original write authority and explicit encryption key before reading evidence", async () => {
    await expect(readOriginalPreflightReceipt(tx, "service", { ...principal, scopes: ["dream:read"] }, "original")).rejects.toMatchObject({ status: 403 });
    vi.stubEnv("AUTH_TOKEN_ENCRYPTION_KEY", ""); await expect(read()).rejects.toMatchObject({ status: 503 }); expect(mocks.findRequest).not.toHaveBeenCalled();
  });
});
