// [Input] Registry108 HTTP envelope, service identity and OAuth or exact Thread/Run delegation.
// [Output] Body limits, capability requirements, actor binding and one activation UOW assertion.
// [Pos] Provider-free Runtime activation ingress test.
// [Sync] 2026-09-15: reject physical/runtime selectors before opening the Admin transaction.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), actor: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workflowRuntimeActivationService", async original => ({
  ...await original<typeof import("./workflowRuntimeActivationService")>(), runWorkflowRuntimeActivationOperation: mocks.run,
}));

import { handleWorkflowRuntimeActivation } from "./workflowRuntimeActivationHandler";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { workflowRuntimeActivationSchemaRequirements } from "./workflowRuntimeActivationService";

const workflowRunId = `run_${"a".repeat(32)}`;
const input = { thread_id: "thread-1", workflow_run_id: workflowRunId, remote_session_ref: "sdk-thread",
  verified_plugins: [{ package_spec: "ink-dream-story@platform-builtin", resolved_version: "1.0.0",
    artifact_digest: `sha256:${"b".repeat(64)}`, has_manifest: true }] };
const output = { thread_id: input.thread_id, workflow_run_id: workflowRunId, workspace_id: "workspace-1",
  runtime_plugin_lock_id: `rpl_${"c".repeat(32)}`, runtime_load_receipt_id: `rlr_${"d".repeat(32)}`,
  agent_session_id: `as_${"e".repeat(32)}`, status: "running", replayed: false };
const actor = { principal: { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" }, threadScope: null, runScope: null };
function request(rawInput: unknown, token = "oauth") {
  return new Request("http://localhost/api/internal/dream/v1/operations/workflow-runtime.activate", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "runtime-activation-original", input: rawInput }),
  });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream-service" }); mocks.actor.mockResolvedValue(actor);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
  mocks.run.mockResolvedValue(output);
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["oauth", [identitySchemaRequirement, ...workflowRuntimeActivationSchemaRequirements]],
  ["idg_grant", [identitySchemaRequirement, ...workflowRuntimeActivationSchemaRequirements,
    runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]],
])("binds %s authority to the exact Thread and Run", async (token, requirements) => {
  const response = await handleWorkflowRuntimeActivation(request(input, token), "workflow-runtime.activate");
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: output, request_id: "runtime-activation-original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual(requirements);
  expect(mocks.actor).toHaveBeenCalledWith({ marker: "tx" }, expect.any(Headers), { id: "dream-service" },
    "dream:write", input.thread_id, input.workflow_run_id);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("workflow-runtime.activate", input, actor,
    "dream-service", "runtime-activation-original", { marker: "tx" });
});

it("rejects actor, database, path and placement selectors before the UOW", async () => {
  for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "runtime_node_id", "path"])
    expect((await handleWorkflowRuntimeActivation(request({ ...input, [key]: "caller" }), "workflow-runtime.activate")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
