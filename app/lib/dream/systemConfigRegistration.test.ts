// [Input] Production operation/receipt Routes with captured new SystemConfig handler and auth/UOW seams.
// [Output] Exact three-name POST routing plus OAuth-only bounded Original PATCH recovery routing.
// [Pos] SystemConfig prefix gate inside registered99; domain/codec/PostgreSQL behavior stays separate.
// [Sync] 2026-09-15: preserve exact user get/patch and Thread get descriptors at positions78-80 of Registry103.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), thread: vi.fn(), service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), read: vi.fn() }));
vi.mock("./userSystemConfigHandler", () => ({
  isUserSystemConfigOperation: (name: string) => ["user-system-config.get", "user-system-config.patch"].includes(name), handleUserSystemConfig: mocks.user,
}));
vi.mock("./threadSystemConfigHandler", () => ({ isThreadSystemConfigOperation: (name: string) => name === "thread-system-config.get", handleThreadSystemConfig: mocks.thread }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./userSystemConfigOriginalReceiptService", () => ({ readOriginalUserSystemConfigReceipt: mocks.read }));
import { AuthBoundaryError } from "../auth/config";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { identitySchemaRequirement } from "./schemaRequirements";
import { userSystemConfigSchemaRequirements } from "./userSystemConfigService";
import { dreamOperations } from "./operationRegistry";
const service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
beforeEach(() => {
  vi.resetAllMocks(); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal); mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.read.mockResolvedValue({ status: "committed", operation: "user-system-config.patch", request_id: "original", result: { success: true } });
});
it("appends exactly three SystemConfig descriptors after the frozen77 catalog", () => {
  expect(dreamOperations).toHaveLength(103);
  expect(dreamOperations.slice(77, 80).map(item => ({ name: item.contract.name, kind: item.capability.kind, scope: item.capability.user_scope, requirements: item.requirements }))).toEqual([
    { name: "user-system-config.get", kind: "read", scope: "dream:read", requirements: [identitySchemaRequirement, ...userSystemConfigSchemaRequirements] },
    { name: "user-system-config.patch", kind: "write", scope: "dream:write", requirements: [identitySchemaRequirement, ...userSystemConfigSchemaRequirements] },
    { name: "thread-system-config.get", kind: "read", scope: "dream:read", requirements: [identitySchemaRequirement, ...userSystemConfigSchemaRequirements] },
  ]);
});
it.each(["user-system-config.get", "user-system-config.patch", "thread-system-config.get"])("public POST routes registered %s exactly once", async operation => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${operation}`, { method: "POST" }), response = new Response("domain-result");
  const selected = operation.startsWith("user-") ? mocks.user : mocks.thread; selected.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation }) })).toBe(response);
  expect(selected).toHaveBeenCalledExactlyOnceWith(request, operation); expect(operation.startsWith("user-") ? mocks.thread : mocks.user).not.toHaveBeenCalled();
});
it("public Original GET requires OAuth write and delegates the bounded patch result", async () => {
  const request = new Request("http://localhost/api/internal/dream/v1/receipts/original?operation=user-system-config.patch", { headers: { authorization: "Bearer user" } });
  const response = await GET(request, { params: Promise.resolve({ requestId: "original" }) }); expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "committed", operation: "user-system-config.patch", request_id: "original", result: { success: true } }, request_id: "original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...userSystemConfigSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "user", service, "dream:write");
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(tx, "service", principal, "user-system-config.patch", "original");
});
it("Original GET rejects duplicate operation and actor/config/path selectors before UOW", async () => {
  for (const query of ["operation=user-system-config.patch&operation=user-system-config.patch", "operation=user-system-config.patch&actor_id=caller", "operation=user-system-config.patch&config_json=caller", "operation=user-system-config.patch&path=caller"])
    expect((await GET(new Request(`http://localhost/api/internal/dream/v1/receipts/original?${query}`, { headers: { authorization: "Bearer user" } }), { params: Promise.resolve({ requestId: "original" }) })).status).toBe(404);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_PURPOSE_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("Original GET fails closed on %s", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  const token = code === "DELEGATION_PURPOSE_DENIED" ? "idg_entity" : "user";
  const response = await GET(new Request("http://localhost/api/internal/dream/v1/receipts/original?operation=user-system-config.patch", { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403); expect(mocks.read).not.toHaveBeenCalled();
});
