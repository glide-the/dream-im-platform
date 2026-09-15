// [Input] Public original GET and fixed OAuth, capability and domain collaborators.
// [Output] Exact three-operation recovery and closed selector/authority failures.
// [Pos] Registered launch recovery ingress gate; active-claim facts use the domain validator.
// [Sync] 2026-09-15: retain OAuth write and exact identity/unified requirements on original GET.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), read: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./dreamLaunchOriginalReceiptService", async original => ({ ...await original<typeof import("./dreamLaunchOriginalReceiptService")>(), readOriginalDreamLaunchReceipt: mocks.read }));
import { AuthBoundaryError } from "../auth/config";
import { dreamLaunchSourceSchemaRequirements } from "./dreamLaunchSourceService";
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
const names = ["dream-launch-source.ensure", "dream-launch-dispatch.claim", "dream-launch-dispatch.finish"];
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const }, service = { id: "service" };
function read(query = `operation=${names[0]}`, token = "original-token") {
  return GET(new Request(`http://localhost/api/internal/dream/v1/receipts/original?${query}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ requestId: "original" }) });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
  mocks.read.mockResolvedValue({ status: "absent", operation: names[0], request_id: "original" });
});
afterEach(() => vi.unstubAllEnvs());
it.each(names)("public GET delegates %s with exact requirements and live write scope", async name => {
  const response = await read(`operation=${name}`); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.transaction.mock.calls[0][0]).toEqual(dreamLaunchSourceSchemaRequirements);
  expect(mocks.principal).toHaveBeenCalledWith({ marker: "tx" }, "original-token", service, "dream:write");
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith({ marker: "tx" }, "service", principal, name, "original");
});
it("rejects duplicate operation and actor/workspace/Run/claim/metadata selectors before lookup", async () => {
  for (const name of names) for (const tail of ["operation=dream-launch-dispatch.finish", "actor_id=caller", "workspace_id=caller", "workflow_run_id=caller", "claim_id=caller", "metadata=caller"])
    expect((await read(`operation=${name}&${tail}`)).status).toBe(404);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_ACTIVATION_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("fails closed on %s before original recovery", async code => {
  for (const name of names) {
    if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
    else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
    expect((await read(`operation=${name}`, code === "DELEGATION_ACTIVATION_DENIED" ? "idg_entity" : undefined)).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403);
  }
  expect(mocks.read).not.toHaveBeenCalled();
});
