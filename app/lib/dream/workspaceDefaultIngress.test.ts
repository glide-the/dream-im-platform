// [Input] Production default Workspace POST/GET with fixed service, OAuth, UOW and domain collaborators.
// [Output] Thin delegation, exact identity/unified caps and closed selector/permission failures.
// [Pos] Registered76 ingress gate; primary owns domain/source and isolated persistent acceptance.
// [Sync] 2026-09-15: preserve old75 dispatch and admit OAuth write without entity grants.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), execute: vi.fn(), read: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workspaceDefaultService", async original => ({ ...await original<typeof import("./workspaceDefaultService")>(), executeWorkspaceDefaultEnsure: mocks.execute }));
vi.mock("./workspaceDefaultOriginalReceiptService", () => ({ readOriginalWorkspaceDefaultReceipt: mocks.read }));
import { AuthBoundaryError } from "../auth/config";
import { handleWorkspaceDefault, workspaceDefaultIngressSchemaRequirements } from "./workspaceDefaultHandler";
import { identitySchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
const name = "workspace-default.ensure", service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
function request(input: unknown = {}, token = "user") { return new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request_id: "original", input }) }); }
function read(query = `operation=${name}`, token = "user") { return GET(new Request(`http://localhost/api/internal/dream/v1/receipts/original?${query}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ requestId: "original" }) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx)); mocks.execute.mockResolvedValue({ workspace_id: "legacy-id" });
  mocks.read.mockResolvedValue({ status: "absent", operation: name, request_id: "original" });
});
afterEach(() => vi.unstubAllEnvs());
it("public POST reaches the named service in one live OAuth write/exact-capability UOW", async () => {
  const response = await POST(request(), { params: Promise.resolve({ operation: name }) }); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(workspaceDefaultIngressSchemaRequirements).toEqual([identitySchemaRequirement, dreamUnifiedSchemaRequirement]);
  expect(mocks.transaction.mock.calls[0][0]).toEqual(workspaceDefaultIngressSchemaRequirements);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "user", service, "dream:write");
  expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(tx, "service", "original", {}, { principal, threadScope: null, runScope: null, editorSessionScope: null });
});
it("rejects caller Workspace/identity/settings/default selectors before any domain UOW", async () => {
  for (const field of ["workspace_id", "actor_id", "settings", "label", "default", "status"])
    expect((await handleWorkspaceDefault(request({ [field]: "caller" }), name)).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it("rejects an unrelated command before reading input or acquiring a transaction", async () => {
  expect((await handleWorkspaceDefault(request(), "workspace-default.replace")).status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_PURPOSE_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("POST fails closed on %s", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  expect((await handleWorkspaceDefault(request({}, code === "DELEGATION_PURPOSE_DENIED" ? "idg_entity" : "user"), name)).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403);
  expect(mocks.execute).not.toHaveBeenCalled();
});
it("public GET retains exact requirements, original identity and OAuth write scope", async () => {
  const response = await read(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.transaction.mock.calls[0][0]).toEqual(workspaceDefaultIngressSchemaRequirements);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "user", service, "dream:write");
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(tx, "service", principal, name, "original"); expect(mocks.execute).not.toHaveBeenCalled();
});
it("GET rejects duplicate operation and ordinary unknown Workspace/default selectors", async () => {
  for (const tail of [`operation=${name}`, "workspace_id=caller", "settings=caller", "unexpected=caller"])
    expect((await read(`operation=${name}&${tail}`)).status).toBe(404);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_PURPOSE_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("GET fails closed on %s", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  expect((await read(undefined, code === "DELEGATION_PURPOSE_DENIED" ? "idg_entity" : "user")).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403);
  expect(mocks.read).not.toHaveBeenCalled();
});
