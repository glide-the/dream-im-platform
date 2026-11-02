// [Input] Original Workflow context ingress with service, exact Thread/Run grants and stored-context seams.
// [Output] Same-Run acceptance and scope, identity, state and strict-input rejection evidence.
// [Pos] Provider-free HTTP boundary tests; the original DelegationService owns grant validity and claim provenance.
// [Sync] 2026-10-26: cover confirmation Run grants while retaining ordinary OAuth and source-Thread reads.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), actor: vi.fn(), delegation: vi.fn(), transaction: vi.fn(), context: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/delegationService", () => ({ DelegationService: class { resolve = mocks.delegation; } }));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workflowContextService", () => ({ authoritativeWorkflowContext: mocks.context }));

import { AuthBoundaryError } from "../auth/config";
import { handleWorkflowContext } from "./workflowContextHandler";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";

const service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "dream", scopes: ["dream:read"], status: "active" as const };
const input = { thread_id: "source-thread" };
const context = { workflow_run_id: `run_${"a".repeat(32)}`, thread_id: input.thread_id,
  deck_id: "deck", agent_id: null, deck_plugin_id: "plugin", deck_plugin_version: "1.0.0",
  deck_plugin_binding_id: "binding", binding_revision: 1, deck_runtime_snapshot_id: "snapshot", runtime_plugin_lock_id: "lock" };
const grant = { principal, threadId: input.thread_id, runId: context.workflow_run_id, editorSessionId: null, purpose: "server-persistence" };
function request(rawInput: unknown = input, token = "idg_run") {
  return new Request("http://localhost/api/internal/dream/v1/operations/workflow-context.resolve", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "workflow-context-original", input: rawInput }),
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue(service); mocks.actor.mockResolvedValue({ principal });
  mocks.delegation.mockResolvedValue(grant); mocks.context.mockResolvedValue(context);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
});
afterEach(() => vi.unstubAllEnvs());

it("returns the same authoritative active Run for an exact Thread persistence grant", async () => {
  const response = await handleWorkflowContext(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { context }, request_id: "workflow-context-original" });
  expect(mocks.delegation).toHaveBeenCalledExactlyOnceWith("idg_run", "dream:read", service.id, input.thread_id);
  expect(mocks.context).toHaveBeenCalledExactlyOnceWith(tx, principal.canonical_user_id, input.thread_id);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, dreamUnifiedSchemaRequirement,
    runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]);
  expect(mocks.actor).not.toHaveBeenCalled();
});

it.each([null, { ...context, workflow_run_id: `run_${"b".repeat(32)}` }])("rejects a Run grant when its active context is missing or belongs to another Run", async value => {
  mocks.context.mockResolvedValueOnce(value);
  const response = await handleWorkflowContext(request());
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("DELEGATION_ENTITY_DENIED");
});

it.each([
  { ...grant, purpose: "gateway-cli" },
  { ...grant, purpose: "editor-stdio" },
  { ...grant, editorSessionId: "editor" },
])("rejects a different purpose or editor scope before reading context", async authority => {
  mocks.delegation.mockResolvedValueOnce(authority);
  const response = await handleWorkflowContext(request());
  expect(response.status).toBe(403);
  expect(mocks.context).not.toHaveBeenCalled();
});

it.each([
  ["expired or revoked", "DELEGATION_REQUIRED", 401],
  ["different service or Thread", "DELEGATION_ENTITY_DENIED", 403],
  ["missing scope", "ACCESS_SCOPE_REQUIRED", 403],
] as const)("propagates %s rejection without reading context", async (_label, code, status) => {
  mocks.delegation.mockRejectedValueOnce(new AuthBoundaryError(code, status));
  const response = await handleWorkflowContext(request());
  expect(response.status).toBe(status);
  expect(mocks.context).not.toHaveBeenCalled();
});

it.each([context, null])("preserves a source-Thread grant's existing active or ordinary-Chat projection", async value => {
  mocks.delegation.mockResolvedValueOnce({ ...grant, runId: null }); mocks.context.mockResolvedValueOnce(value);
  const response = await handleWorkflowContext(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { context: value }, request_id: "workflow-context-original" });
});

it("preserves OAuth actor validation and capability requirements", async () => {
  const response = await handleWorkflowContext(request(input, "oauth"));
  expect(response.status).toBe(200);
  expect(mocks.actor).toHaveBeenCalledExactlyOnceWith(tx, expect.any(Headers), service, "dream:read", input.thread_id,
    undefined, "workflow-context.resolve");
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, dreamUnifiedSchemaRequirement]);
  expect(mocks.delegation).not.toHaveBeenCalled();
});

it("rejects caller-selected actor, Run, Deck or SQL before opening a UOW", async () => {
  for (const key of ["actor_id", "user_id", "workflow_run_id", "run_id", "deck_id", "sql", "path"])
    expect((await handleWorkflowContext(request({ ...input, [key]: "caller" }))).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.context).not.toHaveBeenCalled();
});

it("retains the original schema capability failure", async () => {
  mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY"));
  const response = await handleWorkflowContext(request());
  expect(response.status).toBe(503);
  expect(mocks.context).not.toHaveBeenCalled();
});
