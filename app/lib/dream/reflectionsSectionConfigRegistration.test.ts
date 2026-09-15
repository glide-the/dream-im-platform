// [Input] Production operation/receipt Routes with captured Reflections handlers and OAuth/UOW seams.
// [Output] Exact three-name Registry83 prefix, POST dispatch and bounded original write recovery.
// [Pos] Reflections section-config registration gate; domain and PostgreSQL behavior remain separate.
// [Sync] 2026-09-15: Registry115 extends only the total-length guard; this file still owns its frozen segment.
// [Sync] 2026-09-15: retain Registry83 assertions after the independent Registry106 append.
// [Sync] 2026-09-15: Registry108 extends only the total-length guard; this file still owns its original frozen segment.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handler: vi.fn(),
  service: vi.fn(),
  principal: vi.fn(),
  transaction: vi.fn(),
  read: vi.fn(),
}));

vi.mock("./reflectionsSectionConfigHandler", () => ({
  isReflectionsSectionConfigOperation: (name: string) => [
    "reflections-section-config.get",
    "reflections-section-config.save",
    "reflections-section-config.delete",
  ].includes(name),
  handleReflectionsSectionConfig: mocks.handler,
}));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(),
  requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./reflectionsSectionConfigOriginalReceiptService", async original => ({
  ...await original<typeof import("./reflectionsSectionConfigOriginalReceiptService")>(),
  readOriginalReflectionsSectionConfigReceipt: mocks.read,
}));

import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { dreamOperations } from "./operationRegistry";
import { reflectionsSectionConfigSchemaRequirements } from "./reflectionsSectionConfigService";

const service = { id: "service" };
const tx = { marker: "tx" };
const principal = {
  subject: "subject",
  canonical_user_id: "9007199254740993",
  client_id: "browser",
  scopes: ["dream:write"],
  status: "active" as const,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.service.mockReturnValue(service);
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements: unknown, action: (value: unknown) => Promise<unknown>) => action(tx));
  mocks.read.mockImplementation(async (_tx: unknown, _service: string, _principal: unknown, operation: string, requestId: string) => ({
    status: "committed",
    operation,
    request_id: requestId,
    result: operation.endsWith(".save") ? { saved: true } : { deleted: false },
  }));
});

it("appends exactly three Reflections descriptors after the frozen Registry80 prefix", () => {
    expect(dreamOperations).toHaveLength(115);
  expect(dreamOperations.slice(80, 83).map(item => ({
    name: item.contract.name,
    kind: item.capability.kind,
    scope: item.capability.user_scope,
    background: item.capability.background_scope,
    requirements: item.requirements,
  }))).toEqual([
    { name: "reflections-section-config.get", kind: "read", scope: "dream:read", background: null, requirements: reflectionsSectionConfigSchemaRequirements },
    { name: "reflections-section-config.save", kind: "write", scope: "dream:write", background: null, requirements: reflectionsSectionConfigSchemaRequirements },
    { name: "reflections-section-config.delete", kind: "write", scope: "dream:write", background: null, requirements: reflectionsSectionConfigSchemaRequirements },
  ]);
});

it.each(["get", "save", "delete"])("public POST dispatches reflections-section-config.%s exactly once", async action => {
  const operation = `reflections-section-config.${action}`;
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${operation}`, { method: "POST" });
  const response = new Response("domain-result");
  mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, operation);
});

it.each(["reflections-section-config.save", "reflections-section-config.delete"])("public Original GET delegates bounded %s recovery", async operation => {
  const request = new Request(`http://localhost/api/internal/dream/v1/receipts/original?operation=${operation}`, { headers: { authorization: "Bearer user" } });
  const response = await GET(request, { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ status: "committed", operation, request_id: "original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual(reflectionsSectionConfigSchemaRequirements);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "user", service, "dream:write");
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(tx, "service", principal, operation, "original");
});

it("Original GET rejects read operation, duplicate operation and caller selectors before UOW", async () => {
  for (const query of [
    "operation=reflections-section-config.get",
    "operation=reflections-section-config.save&operation=reflections-section-config.save",
    "operation=reflections-section-config.save&section=echoes",
    "operation=reflections-section-config.delete&actor_id=caller",
    "operation=reflections-section-config.delete&prompt_files_json=caller",
  ]) {
    const response = await GET(new Request(`http://localhost/api/internal/dream/v1/receipts/original?${query}`, { headers: { authorization: "Bearer user" } }), { params: Promise.resolve({ requestId: "original" }) });
    expect(response.status).toBe(404);
  }
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
