// [Input] Public original-receipt GET with fixed service/OAuth/capability and domain collaborators.
// [Output] Exact create/retry dispatch plus selector/scope/entity/capability rejection.
// [Pos] Provider-free public recovery ingress gate; original Preflight and older receipt branches unchanged.
// [Sync] 2026-09-15: require OAuth write authority before owner-bounded creation result recovery.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), read: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workflowRunCreationService", async original => ({ ...await original<typeof import("./workflowRunCreationService")>(), readOriginalRunCreationReceipt: mocks.read }));
import { AuthBoundaryError } from "../auth/config";
import { workflowRunCreationSchemaRequirements } from "./workflowRunCreationService";
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const }, service = { id: "service" };
function request(query = "operation=workflow-run.create", token = "original-token") { return new Request(`http://localhost/api/internal/dream/v1/receipts/original?${query}`, { headers: { authorization: `Bearer ${token}` } }); }
function read(query?: string, token?: string) { return GET(request(query, token), { params: Promise.resolve({ requestId: "original" }) }); }
beforeEach(() => {
  vi.resetAllMocks(); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" })); mocks.read.mockResolvedValue({ status: "absent", operation: "workflow-run.create", request_id: "original" });
});
afterEach(() => vi.unstubAllEnvs());
it.each(["workflow-run.create", "workflow-run.retry"])("public GET delegates %s with exact requirements and live OAuth write scope", async name => {
  const response = await read(`operation=${name}`); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.transaction.mock.calls[0][0]).toEqual(workflowRunCreationSchemaRequirements);
  expect(mocks.principal.mock.calls[0].slice(1)).toEqual(["original-token", service, "dream:write"]);
  expect(mocks.read).toHaveBeenCalledWith({ marker: "tx" }, "service", principal, name, "original");
});
it("rejects duplicate operation and actor/workspace/Run selectors before lookup", async () => {
  for (const query of ["operation=workflow-run.create&operation=workflow-run.retry", "operation=workflow-run.create&actor=caller", "operation=workflow-run.retry&workspace_id=caller", "operation=workflow-run.create&run_id=caller"])
    expect((await read(query)).status).toBe(404);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});
it.each(["DREAM_SCOPE_REQUIRED", "DELEGATION_ACTIVATION_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("fails closed on %s before recovery", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  const response = await read(undefined, code === "DELEGATION_ACTIVATION_DENIED" ? "idg_entity" : undefined);
  expect(response.status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403); expect(mocks.read).not.toHaveBeenCalled();
});
