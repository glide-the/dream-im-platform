// [Input] Closed public ingress requests with server service/OAuth/transaction collaborators.
// [Output] Live same-subject checks and exact schema requirements at every staged transaction.
// [Pos] Provider-free ingress/auth verification; actual SQL stages are separate public evidence.
// [Sync] 2026-09-15: deny principal changes before advancing any subsequent Preflight stage.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), transaction: vi.fn(), execute: vi.fn(), service: vi.fn() }));
vi.mock("../auth/serviceIdentity", () => ({ requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workflowPreflightExecutionService", () => ({ WorkflowPreflightExecutionService: class {
  constructor(public transaction: (action: (tx: unknown) => Promise<unknown>) => Promise<unknown>) {}
  execute(...args: unknown[]) { return mocks.execute(this.transaction, ...args); }
} }));
import { AuthBoundaryError } from "../auth/config";
import { handleWorkflowPreflightExecute, workflowPreflightExecutionSchemaRequirements } from "./workflowPreflightHandler";
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const service = { id: "service", oauthClientId: "browser" };
const input = { workspace_id: "workspace", deck_id: "deck", binding_revision: 7, input_json: '{"v":-0.0}' };
function request(rawInput: unknown = input) { return new Request("http://localhost/api/internal/dream/v1/operations/workflow-preflight.execute", {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer original-token" }, body: JSON.stringify({ request_id: "original", input: rawInput }) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "10000"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements: unknown, action: (tx: unknown) => Promise<unknown>) => action({}));
  mocks.execute.mockImplementation(async (transaction: (action: (tx: unknown) => Promise<unknown>) => Promise<unknown>) => {
    await transaction(async () => "checking"); await transaction(async () => "binding"); return { completed: true };
  });
});
afterEach(() => vi.unstubAllEnvs());
describe("staged Preflight ingress", () => {
  it("rechecks the original OAuth principal and exact capabilities before each stage", async () => {
    const response = await handleWorkflowPreflightExecute(request()); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.principal).toHaveBeenCalledTimes(3);
    for (const [requirements] of mocks.transaction.mock.calls) expect(requirements).toEqual(workflowPreflightExecutionSchemaRequirements);
    for (const call of mocks.principal.mock.calls) expect(call.slice(1)).toEqual(["original-token", service, "dream:write"]);
    expect(mocks.execute.mock.calls[0].slice(1)).toEqual(["service", principal, "original", input]);
  });
  it.each(["subject", "canonical_user_id", "client_id"] as const)("denies changed live %s before the next stage", async field => {
    mocks.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce({ ...principal, [field]: field === "canonical_user_id" ? "42" : "changed" });
    const response = await handleWorkflowPreflightExecute(request()); expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("WORKFLOW_PERMISSION_DENIED"); expect(mocks.principal).toHaveBeenCalledTimes(2);
  });
  it("rejects actor/fact patches before authentication or any stage", async () => {
    const response = await handleWorkflowPreflightExecute(request({ ...input, readiness: true })); expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("keeps missing physical capability fail-closed before execution", async () => {
    mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY"));
    const response = await handleWorkflowPreflightExecute(request()); expect(response.status).toBe(503); expect(mocks.execute).not.toHaveBeenCalled();
  });
});
