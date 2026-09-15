// [Input] Registry101 POST handler with captured service, OAuth, UOW, receipt and domain seams.
// [Output] Exact body limit, principal derivation, one receipt UOW and fail-closed ingress evidence.
// [Pos] Provider-free local-data HTTP boundary test; Repository behavior is tested separately.
// [Sync] 2026-09-15: prove both writes are OAuth-only and receipt wrapped before registration.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), run: vi.fn(), receipt: vi.fn(), identity: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./localDataImportService", async original => ({ ...await original<typeof import("./localDataImportService")>(), runLocalDataImportOperation: mocks.run }));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  constructor(_tx: unknown, serviceId: string, subject: string) { mocks.identity(serviceId, subject); }
  async execute(operation: string, requestId: string, input: unknown, output: unknown, action: () => Promise<unknown>) {
    mocks.receipt(operation, requestId, input, output); return action();
  }
} }));
import { AuthBoundaryError } from "../auth/config";
import { handleLocalDataImport } from "./localDataImportHandler";
import { localDataImportSchemaRequirements } from "./localDataImportService";
import { identitySchemaRequirement } from "./schemaRequirements";

const service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const empty = { sessions: [], pictures: [], preferences: null, reports: [] };
function request(input: unknown, token = "oauth") {
  return new Request("http://localhost/api/internal/dream/v1/operations/local-data.import", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request_id: "original", input }) });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.run.mockImplementation(async name => name === "local-data.import" ? { success: true, imported: { sessions: 0, pictures: 0, preferences: 0, reports: 0 } } : { success: true, first_login_completed: 1 });
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["local-data.import", empty, { success: true, imported: { sessions: 0, pictures: 0, preferences: 0, reports: 0 } }],
  ["first-login.complete", {}, { success: true, first_login_completed: 1 }],
] as const)("executes %s through the exact OAuth receipt UOW", async (name, input, output) => {
  const response = await handleLocalDataImport(request(input), name);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: output, request_id: "original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...localDataImportSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "oauth", service, "dream:write");
  expect(mocks.identity).toHaveBeenCalledExactlyOnceWith("service", "subject");
  expect(mocks.receipt.mock.calls[0].slice(0, 3)).toEqual([name, "original", input]);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(name, input, { principal, threadScope: null, editorSessionScope: null, runScope: null }, tx);
});

it("rejects identity and physical selectors before opening a UOW", async () => {
  for (const key of ["user_id", "subject", "actor", "sql", "table", "column", "database_url"])
    expect((await handleLocalDataImport(request({ ...empty, [key]: "caller" }), "local-data.import")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
});

it.each([
  ["missing OAuth", new AuthBoundaryError("INVALID_ACCESS_TOKEN", 401), 401],
  ["wrong scope", new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403), 403],
  ["missing capability", new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY"), 503],
] as const)("fails closed for %s", async (_label, error, status) => {
  if (status === 503) mocks.transaction.mockRejectedValueOnce(error); else mocks.principal.mockRejectedValueOnce(error);
  const response = await handleLocalDataImport(request(empty, status === 401 ? "" : "oauth"), "local-data.import");
  expect(response.status).toBe(status); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
});

it("rejects an unrelated operation before parsing or acquiring a UOW", async () => {
  expect((await handleLocalDataImport(request(empty), "local-data.replace")).status).toBe(404);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
