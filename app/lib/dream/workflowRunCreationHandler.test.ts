// [Input] Closed unregistered create/retry envelopes with fixed service/OAuth/capability collaborators.
// [Output] Successful composition and write-authority/identity/closed-input rejection before a creation UOW.
// [Pos] Provider-free ingress verification; public SQL and frozen contract registration remain pending.
// [Sync] 2026-09-15: check every clean retry boundary uses the same live OAuth owner.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ principal: vi.fn(), transaction: vi.fn(), execute: vi.fn(), service: vi.fn() }));
vi.mock("../auth/serviceIdentity", () => ({ requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workflowRunCreationService", async importOriginal => ({ ...await importOriginal<typeof import("./workflowRunCreationService")>(), WorkflowRunCreationService: class {
  constructor(private readonly transaction: (action: (tx: unknown) => Promise<unknown>) => Promise<unknown>) {}
  execute(...args: unknown[]) { return mocks.execute(this.transaction, ...args); }
} }));
import { AuthBoundaryError } from "../auth/config";
import { handleWorkflowRunCreation, workflowRunCreationSchemaRequirements } from "./workflowRunCreationHandler";
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const service = { id: "service", oauthClientId: "browser" };
const create = { workspace_id: "workspace", workflow_preflight_id: `pf_${"a".repeat(32)}`, preflight_token: "pft_fixed", idempotency_key: "business_key",
  source_voice_thread_id: null, source_message_id: null, source_message_time: null };
function request(raw: unknown = create) { return new Request("http://localhost/api/internal/dream/v1/operations/workflow-run.create", {
  method: "POST", headers: { "content-type": "application/json", authorization: "Bearer original-token" }, body: JSON.stringify({ request_id: "original", input: raw }) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "10000"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements: unknown, action: (tx: unknown) => Promise<unknown>) => action({}));
  mocks.execute.mockImplementation(async (transaction: (action: (tx: unknown) => Promise<unknown>) => Promise<unknown>) => {
    await transaction(async () => "prerequisite"); await transaction(async () => "creation"); return { done: true };
  });
});
afterEach(() => vi.unstubAllEnvs());
it.each(["workflow-run.create", "workflow-run.retry"])("uses same live OAuth/write authority and exact physical requirements for %s", async operation => {
  const input = operation.endsWith("retry") ? { workspace_id: create.workspace_id, workflow_preflight_id: create.workflow_preflight_id,
    preflight_token: create.preflight_token, idempotency_key: create.idempotency_key, workflow_run_id: `run_${"b".repeat(32)}` } : create;
  const response = await handleWorkflowRunCreation(request(input), operation); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.principal).toHaveBeenCalledTimes(3);
  for (const [requirements] of mocks.transaction.mock.calls) expect(requirements).toEqual(workflowRunCreationSchemaRequirements);
  for (const call of mocks.principal.mock.calls) expect(call.slice(1)).toEqual(["original-token", service, "dream:write"]);
  expect(mocks.execute.mock.calls[0].slice(1)).toEqual([operation, "service", principal, "original", input]);
});
it.each(["subject", "canonical_user_id", "client_id"] as const)("rejects changed live %s before entering the next UOW", async field => {
  mocks.principal.mockResolvedValueOnce(principal).mockResolvedValueOnce({ ...principal, [field]: field === "canonical_user_id" ? "42" : "changed" });
  const response = await handleWorkflowRunCreation(request(), "workflow-run.create"); expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("WORKFLOW_PERMISSION_DENIED"); expect(mocks.principal).toHaveBeenCalledTimes(2);
});
it("rejects unknown operations and caller actor/frozen/status/source replacement selectors before authentication", async () => {
  expect((await handleWorkflowRunCreation(request(), "workflow-run.patch")).status).toBe(404);
  for (const key of ["created_by", "deck_plugin_id", "status"]) expect((await handleWorkflowRunCreation(request({ ...create, [key]: "caller" }), "workflow-run.create")).status).toBe(400);
  const retry = { workspace_id: create.workspace_id, workflow_preflight_id: create.workflow_preflight_id, preflight_token: create.preflight_token,
    idempotency_key: "retry", workflow_run_id: `run_${"b".repeat(32)}`, source_message_id: "replacement" };
  expect((await handleWorkflowRunCreation(request(retry), "workflow-run.retry")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it.each(["DREAM_DATA_SCHEMA_NOT_READY", "DREAM_SCOPE_REQUIRED", "DELEGATION_ACTIVATION_DENIED"])("fails closed on %s before creation", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  expect((await handleWorkflowRunCreation(request(), "workflow-run.create")).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403);
  expect(mocks.execute).not.toHaveBeenCalled();
});
