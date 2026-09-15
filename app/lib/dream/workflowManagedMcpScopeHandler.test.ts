// [Input] Registry107 Handler with captured actor, Run/Thread grant and UOW seams.
// [Output] OAuth/delegation requirements, body limit and strict pre-UOW rejection evidence.
// [Pos] Provider-free managed MCP scope HTTP boundary test.
// [Sync] 2026-09-15: prove Thread and Run enter one read-only capability UOW.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), actor: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workflowManagedMcpScopeService", async original => ({ ...await original<typeof import("./workflowManagedMcpScopeService")>(), runWorkflowManagedMcpScopeOperation: mocks.run }));

import { handleWorkflowManagedMcpScope } from "./workflowManagedMcpScopeHandler";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { workflowManagedMcpScopeSchemaRequirements } from "./workflowManagedMcpScopeService";

const run = `run_${"a".repeat(32)}`;
const input = { thread_id: "thread-1", workflow_run_id: run };
const output = { ...input, workspace_id: "workspace-1" };
const actor = { principal: { subject: "subject", canonical_user_id: "42", client_id: "dream", scopes: ["dream:read"], status: "active" }, threadScope: null, runScope: null };
function request(rawInput: unknown, token = "oauth") { return new Request("http://localhost/api/internal/dream/v1/operations/workflow-managed-mcp-scope.resolve", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ request_id: "managed-scope-original", input: rawInput }),
}); }

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockReturnValue({ id: "service" }); mocks.actor.mockResolvedValue(actor); mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" })); mocks.run.mockResolvedValue(output); });
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["oauth", [identitySchemaRequirement, ...workflowManagedMcpScopeSchemaRequirements]],
  ["idg_grant", [identitySchemaRequirement, ...workflowManagedMcpScopeSchemaRequirements, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]],
])("binds %s to the input Thread and Run", async (token, requirements) => {
  const response = await handleWorkflowManagedMcpScope(request(input, token), "workflow-managed-mcp-scope.resolve");
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: output, request_id: "managed-scope-original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual(requirements);
  expect(mocks.actor).toHaveBeenCalledWith(expect.anything(), expect.any(Headers), expect.anything(), "dream:read", input.thread_id, input.workflow_run_id);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("workflow-managed-mcp-scope.resolve", input, actor, { marker: "tx" });
});

it("rejects identity, workspace, SQL and physical selectors before UOW", async () => {
  for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "runtime_node_id", "path"])
    expect((await handleWorkflowManagedMcpScope(request({ ...input, [key]: "caller" }), "workflow-managed-mcp-scope.resolve")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
