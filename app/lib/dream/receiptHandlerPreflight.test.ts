// [Input] Public original Preflight receipt requests and live service/OAuth/capability collaborators.
// [Output] Three durable states and fail-closed scope/query/capability handling through the production Route.
// [Pos] Provider-free ingress tests; full encrypted result recovery and real SQL are validated separately.
// [Sync] 2026-09-15: keep fixed Preflight recovery separate from generic two-state receipts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), transaction: vi.fn(), principal: vi.fn(), original: vi.fn() }));
vi.mock("../auth/serviceIdentity", () => ({ requireDreamService: mocks.service, requireBackgroundScope: vi.fn() }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workflowPreflightOriginalReceiptService", () => ({ readOriginalPreflightReceipt: mocks.original }));
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { AuthBoundaryError } from "../auth/config";
import { workflowPreflightExecutionSchemaRequirements } from "./schemaRequirements";
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const service = { id: "service", oauthClientId: "browser" };
function request(query = "operation=workflow-preflight.execute", requestId = "original") {
  return GET(new Request(`http://localhost/api/internal/dream/v1/receipts/${requestId}?${query}`, { headers: { authorization: "Bearer original-token" } }),
    { params: Promise.resolve({ requestId }) });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements: unknown, action: (tx: unknown) => Promise<unknown>) => action({}));
  mocks.original.mockResolvedValue({ status: "absent", operation: "workflow-preflight.execute", request_id: "original" });
});
afterEach(() => vi.unstubAllEnvs());
describe("public fixed original Preflight recovery", () => {
  it.each(["absent", "in_progress", "committed"])("returns service-owned %s evidence after live OAuth and exact physical checks", async status => {
    const result = { status, operation: "workflow-preflight.execute", request_id: "original" };
    mocks.original.mockResolvedValue(result);
    const response = await request(); expect(response.status).toBe(200); expect((await response.json()).data).toEqual(result);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.transaction.mock.calls[0][0]).toEqual(workflowPreflightExecutionSchemaRequirements);
    expect(mocks.principal.mock.calls[0].slice(1)).toEqual(["original-token", service, "dream:write"]);
    expect(mocks.original.mock.calls[0].slice(1)).toEqual(["service", principal, "original"]);
  });
  it.each(["operation=workflow-preflight.execute&actor=foreign", "operation=workflow-preflight.execute&operation=workflow-preflight.execute"])("rejects ambiguous/selector queries before a transaction", async query => {
    const response = await request(query); expect(response.status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("denies insufficient OAuth authority before looking up any original result", async () => {
    mocks.principal.mockRejectedValue(new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403));
    const response = await request(); expect(response.status).toBe(403); expect(mocks.original).not.toHaveBeenCalled();
  });
  it("fails closed on missing request capability before reading the principal/result", async () => {
    mocks.transaction.mockRejectedValue(new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY"));
    const response = await request(); expect(response.status).toBe(503); expect(mocks.principal).not.toHaveBeenCalled(); expect(mocks.original).not.toHaveBeenCalled();
  });
  it("does not turn malformed encrypted original state into absent evidence", async () => {
    mocks.original.mockRejectedValue(new AuthBoundaryError("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE"));
    const response = await request(); expect(response.status).toBe(503); expect((await response.json()).error.code).toBe("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE");
  });
});
