// [Input] Configured service, exact Thread selector and OAuth, persistence or Reflections authority.
// [Output] Owner-read actor with bounded Thread/Run, null Editor and exact capability checks.
// [Pos] Registered Thread config ingress gate; no write, receipt, Runtime execution or caller authority selectors.
// [Sync] 2026-09-15: prove Reflections authority resolves only the exact matching Thread config read.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), resolve: vi.fn(), resolveReflection: vi.fn(), context: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("../auth/delegationService", () => ({ DelegationService: class { resolve = mocks.resolve; } }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workflowContextService", () => ({ authoritativeWorkflowContext: mocks.context }));
vi.mock("./reflectionTaskAuthorityService", () => ({ resolveReflectionTaskAuthority: mocks.resolveReflection }));
vi.mock("./threadSystemConfigService", async original => ({ ...await original<typeof import("./threadSystemConfigService")>(), runThreadSystemConfigOperation: mocks.run }));
import { AuthBoundaryError } from "../auth/config";
import { handleThreadSystemConfig } from "./threadSystemConfigHandler";
import { identitySchemaRequirement, reflectionTaskSchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { threadSystemConfigSchemaRequirements } from "./threadSystemConfigService";
const name = "thread-system-config.get", thread = "thread", run = `run_${"a".repeat(32)}`, service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read"], status: "active" as const };
const codec = vi.fn(async () => ({ config_json: "{}" }));
const resolved = { principal, serviceClientId: "service", threadId: thread, runId: run, purpose: "server-persistence", editorSessionId: null, tokenHash: "hash", gatewayApiKeyId: null };
function request(input: unknown = { thread_id: thread }, token = "user") { return new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request_id: "snapshot", input }) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx)); mocks.resolve.mockResolvedValue(resolved);
  mocks.resolveReflection.mockResolvedValue({ principal, serviceClientId: "service", threadScope: thread, runScope: null, editorSessionScope: null, purpose: "reflections-worker" });
  mocks.context.mockResolvedValue({ workflow_run_id: run }); mocks.run.mockResolvedValue({ config_json: "{}" });
});
it("reads the exact task-bound Thread through the Reflections authority", async () => {
  const response = await handleThreadSystemConfig(request(undefined, `rta_${"a".repeat(43)}`), name, codec); expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...threadSystemConfigSchemaRequirements, reflectionTaskSchemaRequirement]);
  expect(mocks.resolveReflection).toHaveBeenCalledExactlyOnceWith(tx, `rta_${"a".repeat(43)}`, name, "service");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(name, { thread_id: thread }, { principal, threadScope: thread, runScope: null, editorSessionScope: null }, tx, codec);
  expect(mocks.principal).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
});
it("rejects a task authority bound to another Thread", async () => {
  mocks.resolveReflection.mockResolvedValueOnce({ principal, serviceClientId: "service", threadScope: "other", runScope: null, editorSessionScope: null, purpose: "reflections-worker" });
  const response = await handleThreadSystemConfig(request(undefined, `rta_${"a".repeat(43)}`), name, codec);
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("REFLECTION_AUTHORITY_ENTITY_DENIED"); expect(mocks.run).not.toHaveBeenCalled();
});
afterEach(() => vi.unstubAllEnvs());
it("reads an OAuth-owned Thread with null entity scopes", async () => {
  const response = await handleThreadSystemConfig(request(), name, codec); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: { config_json: "{}" }, request_id: "snapshot" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...threadSystemConfigSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "user", service, "dream:read");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(name, { thread_id: thread }, { principal, threadScope: null, runScope: null, editorSessionScope: null }, tx, codec);
  expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.context).not.toHaveBeenCalled();
});
it.each([[run, true], [null, false]] as const)("reads a persistence Thread with Run %s", async (runId, checksCurrent) => {
  mocks.resolve.mockResolvedValueOnce({ ...resolved, runId });
  const response = await handleThreadSystemConfig(request(undefined, "idg_persistence"), name, codec); expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...threadSystemConfigSchemaRequirements, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith("idg_persistence", "dream:read", "service", thread);
  expect(mocks.context).toHaveBeenCalledTimes(checksCurrent ? 1 : 0);
  if (checksCurrent) expect(mocks.context).toHaveBeenCalledExactlyOnceWith(tx, principal.canonical_user_id, thread);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(name, { thread_id: thread }, { principal, threadScope: thread, runScope: runId, editorSessionScope: null }, tx, codec);
});
it.each([
  ["purpose", { purpose: "editor" }, false], ["editor", { editorSessionId: "editor" }, false],
  ["missing current Run", {}, true], ["different current Run", {}, true],
] as const)("rejects delegated %s before reading config", async (_case, patch, checkContext) => {
  mocks.resolve.mockResolvedValueOnce({ ...resolved, ...patch });
  if (checkContext) mocks.context.mockResolvedValueOnce(_case === "missing current Run" ? null : { workflow_run_id: `run_${"b".repeat(32)}` });
  expect((await handleThreadSystemConfig(request(undefined, "idg_persistence"), name, codec)).status).toBe(403);
  expect(mocks.context).toHaveBeenCalledTimes(checkContext ? 1 : 0); expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects caller Run/actor/config/storage/path selectors before UOW", async () => {
  for (const key of ["workflow_run_id", "editor_session_id", "actor_id", "config_json", "sql", "table", "codec", "path"])
    expect((await handleThreadSystemConfig(request({ thread_id: thread, [key]: "caller" }), name, codec)).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_REQUIRED", "DREAM_DATA_SCHEMA_NOT_READY"])("fails closed on %s", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else if (code === "DELEGATION_REQUIRED") mocks.resolve.mockRejectedValueOnce(new AuthBoundaryError(code, 401));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  const token = code === "DELEGATION_REQUIRED" ? "idg_invalid" : "user";
  expect((await handleThreadSystemConfig(request(undefined, token), name, codec)).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : code === "DELEGATION_REQUIRED" ? 401 : 403);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects an unrelated command before acquiring UOW", async () => {
  expect((await handleThreadSystemConfig(request(), "thread-system-config.patch", codec)).status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled();
});
