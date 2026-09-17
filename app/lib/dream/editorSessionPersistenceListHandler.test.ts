// [Input] OAuth or exact opaque delegation/Reflections bearer at the existing Session/Editor internal handler.
// [Output] Only bounded Session list and editor-stdio Editor load reach domain execution.
// [Pos] Provider-free ingress authorization proof; DelegationService remains the token authority.
// [Sync] 2026-09-15: cover the Reflections metadata-only Session-list authority boundary.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), resolve: vi.fn(), resolveReflection: vi.fn(), transaction: vi.fn(), run: vi.fn(), receipt: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("../auth/delegationService", () => ({ DelegationService: class { resolve = mocks.resolve; } }));
vi.mock("./reflectionTaskAuthorityService", () => ({ resolveReflectionTaskAuthority: mocks.resolveReflection }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./editorSessionService", () => ({ runEditorSessionOperation: mocks.run }));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  async execute(_operation: string, _requestId: string, _input: unknown, _output: unknown, action: () => Promise<unknown>) { mocks.receipt(); return action(); }
} }));
import { AuthBoundaryError } from "../auth/config";
import { handleEditorSessionOperation } from "./editorSessionHandler";
import { identitySchemaRequirement, reflectionTaskSchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
const service = { id: "service" };
const tx = { marker: "tx" };
const token = `idg_${"a".repeat(43)}`;
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read", "dream:write", "editor:read", "editor:write"], status: "active" as const };
const persistenceActor = { principal, serviceClientId: service.id, threadId: "thread1", runId: "run1", purpose: "server-persistence" as const, editorSessionId: null, tokenHash: "hash", gatewayApiKeyId: null };
function request(name: string, input: unknown, bearer = token, cookie?: string) {
  return new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ request_id: "original", input }) });
}
const listInput = { start_date: null, end_date: null, include_text: false };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal); mocks.resolve.mockResolvedValue(persistenceActor);
  mocks.resolveReflection.mockResolvedValue({ principal, serviceClientId: service.id, threadScope: "thread1", purpose: "reflections-worker" });
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx)); mocks.run.mockResolvedValue({ sessions: [] });
});
it("resolves a Reflections authority only for metadata-only Session list", async () => {
  const reflectionToken = `rta_${"a".repeat(43)}`;
  const response = await handleEditorSessionOperation(request("session.list", listInput, reflectionToken), "session.list");
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, runtimePurposeSchemaRequirement, reflectionTaskSchemaRequirement]);
  expect(mocks.resolveReflection).toHaveBeenCalledExactlyOnceWith(tx, reflectionToken, "session.list", service.id);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("session.list", listInput, expect.objectContaining({ principal, threadScope: "thread1", editorSessionScope: null, delegationPurpose: "reflections-worker", serviceId: service.id }), tx);
});
it.each([
  ["session.list", { ...listInput, include_text: true }],
  ["session.get", { session_id: "session1" }],
] as const)("rejects Reflections authority for %s outside the metadata-only allowance", async (name, input) => {
  const response = await handleEditorSessionOperation(request(name, input, `rta_${"a".repeat(43)}`), name);
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("REFLECTION_AUTHORITY_OPERATION_DENIED");
  expect(mocks.resolveReflection).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});
afterEach(() => vi.unstubAllEnvs());
it("keeps OAuth Session list on the existing service-token path", async () => {
  const response = await handleEditorSessionOperation(request("session.list", listInput, "oauth"), "session.list");
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: { sessions: [] }, request_id: "original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, runtimePurposeSchemaRequirement]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "oauth", service, "dream:read"); expect(mocks.resolve).not.toHaveBeenCalled();
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("session.list", listInput, { principal, threadScope: null, editorSessionScope: null, delegationPurpose: null }, tx);
});
it("resolves the exact service-bound server-persistence grant before listing its canonical owner", async () => {
  const response = await handleEditorSessionOperation(request("session.list", listInput), "session.list");
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: { sessions: [] }, request_id: "original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, runtimePurposeSchemaRequirement, runtimeDelegationSchemaRequirement]);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(token, "dream:read", service.id);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("session.list", listInput, expect.objectContaining({ principal, threadScope: "thread1", editorSessionScope: null, delegationPurpose: "server-persistence", serviceId: service.id }), tx);
});
it.each([
  ["gateway-cli", null],
  ["editor-stdio", "session1"],
  ["server-persistence", "session1"],
] as const)("rejects %s or an Editor-bound grant after full resolution", async (purpose, editorSessionId) => {
  mocks.resolve.mockResolvedValueOnce({ ...persistenceActor, purpose, editorSessionId });
  const response = await handleEditorSessionOperation(request("session.list", listInput), "session.list");
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("DELEGATION_PURPOSE_DENIED"); expect(mocks.run).not.toHaveBeenCalled();
});
it.each([
  ["wrong service", "DELEGATION_ENTITY_DENIED", 403],
  ["missing dream scope", "ACCESS_SCOPE_REQUIRED", 403],
  ["expired", "DELEGATION_REQUIRED", 401],
  ["revoked", "DELEGATION_REQUIRED", 401],
] as const)("preserves the resolver's %s denial", async (_label, code, status) => {
  mocks.resolve.mockRejectedValueOnce(new AuthBoundaryError(code, status));
  const response = await handleEditorSessionOperation(request("session.list", listInput), "session.list");
  expect(response.status).toBe(status); expect((await response.json()).error.code).toBe(code); expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects cookie-bearing delegated requests before resolution", async () => {
  const response = await handleEditorSessionOperation(request("session.list", listInput, token, "session=ambient"), "session.list");
  expect(response.status).toBe(401); expect((await response.json()).error.code).toBe("DELEGATION_REQUIRED"); expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});
it.each([
  ["session.save", { session_id: "session1", editor_state: { id: "session1", cells: [], commentors: [], tasks: [], weightPath: [], overlappedPhrases: [], notFoundPhrases: [] }, name: null, labels: null, created_at: null }],
  ["session.get", { session_id: "session1" }],
  ["session.batch", { session_ids: ["session1"] }],
  ["session.text-list", {}],
  ["session.delete", { session_id: "session1" }],
] as const)("does not admit server-persistence for %s", async (name, input) => {
  const response = await handleEditorSessionOperation(request(name, input), name);
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("DELEGATION_PURPOSE_DENIED"); expect(mocks.run).not.toHaveBeenCalled();
});
it("preserves editor-stdio load with exact Editor binding", async () => {
  mocks.resolve.mockResolvedValueOnce({ ...persistenceActor, purpose: "editor-stdio", editorSessionId: "session1" }); mocks.run.mockResolvedValueOnce({ session_id: "session1", editor_state: null, updated_at: null });
  const response = await handleEditorSessionOperation(request("editor-state.load", { session_id: "session1" }), "editor-state.load");
  expect(response.status).toBe(200); expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(token, "editor:read", service.id, undefined, undefined, "session1");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("editor-state.load", { session_id: "session1" }, expect.objectContaining({ delegationPurpose: "editor-stdio", editorSessionScope: "session1", threadScope: "thread1" }), tx);
});
