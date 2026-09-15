// [Input] Frozen Registry99 prefix, live Registry101 DTOs and shared routes inside Registry103.
// [Output] Exact local-data segment, OAuth dispatch and unknown-commit recovery evidence.
// [Pos] Registration gate for local-data.import and first-login.complete.
// [Sync] 2026-09-15: preserve the two reviewed OAuth writes before the Registry103 picture suffix.
// [Sync] 2026-09-15: retain Registry101 assertions after the independent Registry106 append.
// [Sync] 2026-09-15: Registry107 extends only the total-length guard; this file still owns its original frozen segment.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const names = ["local-data.import", "first-login.complete"] as const;
const mocks = vi.hoisted(() => ({ handler: vi.fn(), service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), find: vi.fn() }));
vi.mock("./localDataImportHandler", () => ({
  isLocalDataImportOperation: (name: string) => names.includes(name as typeof names[number]),
  handleLocalDataImport: mocks.handler,
}));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./receipts", () => ({ ReceiptRepository: class { find = mocks.find; } }));

import generated103 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { localDataImportOperationContracts } from "./localDataImportDto";
import { localDataImportSchemaRequirements } from "./localDataImportService";
import { identitySchemaRequirement } from "./schemaRequirements";

const service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
beforeEach(() => {
  vi.resetAllMocks(); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx)); mocks.find.mockResolvedValue(null);
});

it("preserves the complete Registry99 prefix and appends exactly two OAuth writes as Registry101", () => {
    expect(dreamOperations).toHaveLength(107);
  expect(generated103).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 99))).digest("hex")).toBe("bc1d8c0c033673c91f5e5ba3c11316c366d20aa8e1693bdc71b9e4425a9b7e85");
  expect(dreamOperations.slice(99, 101).map(item => item.contract.name)).toEqual(names);
  for (const item of dreamOperations.slice(99, 101)) {
    expect(item.capability).toMatchObject({ kind: "write", user_scope: "dream:write", background_scope: null });
    expect(item.requirements).toEqual([identitySchemaRequirement, ...localDataImportSchemaRequirements]);
  }
});

it.each(names)("production POST dispatches %s exactly once", async name => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" }), response = new Response("domain-result");
  mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it.each(names)("original GET reads %s by exact service and OAuth subject without replay", async name => {
  const output = name === "local-data.import" ? { success: true, imported: { sessions: 1, pictures: 2, preferences: 4, reports: 3 } } : { success: true, first_login_completed: 1 };
  mocks.find.mockResolvedValueOnce({ inputSha256: "a".repeat(64), result: output, threadScope: null, editorSessionScope: null, runScope: null });
  const response = await GET(new Request(`http://localhost/api/internal/dream/v1/receipts/original?operation=${name}`, { headers: { authorization: "Bearer oauth" } }), { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(200); expect((await response.json()).data).toEqual({ status: "committed", operation: name, request_id: "original", result: output });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...localDataImportSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "oauth", service, "dream:write");
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith(name, "original");
});

it("returns explicit absence and rejects selectors or malformed receipt scope", async () => {
  let response = await GET(new Request("http://localhost/api/internal/dream/v1/receipts/original?operation=local-data.import", { headers: { authorization: "Bearer oauth" } }), { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(200); expect((await response.json()).data).toEqual({ status: "absent", operation: "local-data.import", request_id: "original" });
  response = await GET(new Request("http://localhost/api/internal/dream/v1/receipts/original?operation=local-data.import&user_id=1", { headers: { authorization: "Bearer oauth" } }), { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(404);
  mocks.find.mockResolvedValueOnce({ inputSha256: "a".repeat(64), result: { success: true, first_login_completed: 1 }, threadScope: "thread", editorSessionScope: null, runScope: null });
  response = await GET(new Request("http://localhost/api/internal/dream/v1/receipts/original?operation=first-login.complete", { headers: { authorization: "Bearer oauth" } }), { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(503); expect((await response.json()).error.code).toBe("LOCAL_DATA_RECEIPT_INVALID");
});

it("keeps the live DTO contracts behind the registered descriptors", () => {
  for (const [name, operation] of Object.entries(localDataImportOperationContracts)) {
    const registered = dreamOperations.find(item => item.contract.name === name);
    expect(registered?.capability.contract_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(operation.kind).toBe("write"); expect(operation.userScope).toBe("dream:write");
  }
});
