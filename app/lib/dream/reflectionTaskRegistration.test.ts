// [Input] Frozen Registry83, reviewed Reflections candidate and production POST/original-receipt Routes.
// [Output] Exact Registry99 segment plus OAuth/background dispatch and recovery routing evidence inside Registry101.
// [Pos] Reflections registration gate; repository behavior and PostgreSQL migration execution remain separate.
// [Sync] 2026-09-15: preserve the sixteen-operation Reflections segment after the Registry101 local-data append.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const operationNames = [
  "reflection-task.create", "reflection-task.start", "reflection-task.get", "reflection-task.latest",
  "reflection-task.events", "analysis-report.list", "analysis-report.save", "reflection-task.worker-load",
  "reflection-task.advance", "reflection-section.begin", "reflection-section.authority-renew",
  "reflection-section.authority-revoke", "reflection-section.transcript", "reflection-section.finish",
  "reflection-event.append", "reflection-report.ensure",
] as const;
const oauthWrites = ["reflection-task.create", "reflection-task.start", "analysis-report.save"] as const;
const backgroundWrites = [
  "reflection-task.worker-load", "reflection-task.advance", "reflection-section.begin",
  "reflection-section.authority-renew", "reflection-section.authority-revoke", "reflection-section.finish",
  "reflection-event.append", "reflection-report.ensure",
] as const;
const mocks = vi.hoisted(() => ({ handler: vi.fn(), service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), find: vi.fn(), read: vi.fn() }));
vi.mock("./reflectionTaskHandler", () => ({
  isReflectionTaskOperation: (name: string) => operationNames.includes(name as typeof operationNames[number]),
  handleReflectionTaskOperation: mocks.handler,
}));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./receipts", () => ({ ReceiptRepository: class { find = mocks.find; } }));
vi.mock("./reflectionTaskService", async original => ({ ...await original<typeof import("./reflectionTaskService")>(), readOriginalReflectionTaskBackgroundReceipt: mocks.read }));

import candidate from "../../../docs/architecture/admin-dream-reflection-task-operation-candidate.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { identitySchemaRequirement, reflectionTaskSchemaRequirements } from "./schemaRequirements";

const service = { id: "service", backgroundScopes: ["reflections:execute"] };
const tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" as const };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.service.mockReturnValue(service);
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.find.mockResolvedValue(null);
  mocks.read.mockResolvedValue(null);
});

it("preserves all 83 published descriptors and appends the reviewed sixteen as Registry99", () => {
  expect(dreamOperations).toHaveLength(101);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 83))).digest("hex")).toBe("a5f73bf39a8c5f639e636f255b1948349da938be2d354bd3e175261f9af85d6e");
  expect(candidate.status).toBe("registered_registry99_source");
  expect(candidate.operations).toHaveLength(16);
  for (const [index, reviewed] of candidate.operations.entries()) {
    const registered = dreamOperations[83 + index];
    expect(registered.contract).toEqual(reviewed.contract);
    expect(registered.requirements).toEqual(candidate.requirements);
    expect(registered.capability).toEqual({
      name: reviewed.name,
      kind: reviewed.kind,
      user_scope: reviewed.user_scope,
      background_scope: reviewed.background_scope,
      input_schema_version: 1,
      output_schema_version: 1,
      contract_sha256: reviewed.contract_sha256,
    });
  }
  expect(candidate.operations.filter(item => item.audience === "oauth")).toHaveLength(7);
  expect(candidate.operations.filter(item => item.audience === "background")).toHaveLength(9);
});

it.each(operationNames)("production POST dispatches registered %s exactly once", async operation => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${operation}`, { method: "POST" }), response = new Response("domain-result");
  mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, operation);
});

it.each(oauthWrites)("OAuth original GET resolves %s with the live write principal", async operation => {
  const request = new Request(`http://localhost/api/internal/dream/v1/receipts/original?operation=${operation}`, { headers: { authorization: "Bearer user" } });
  const response = await GET(request, { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ status: "absent", operation, request_id: "original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...reflectionTaskSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "user", service, "dream:write");
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith(operation, "original");
});

it.each(backgroundWrites)("background original GET resolves %s by exact service/task without browser bearer", async operation => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const request = new Request(`http://localhost/api/internal/dream/v1/receipts/original?operation=${operation}&task_id=${taskId}`);
  const response = await GET(request, { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ status: "absent", operation, request_id: "original" });
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(operation, taskId, "original", service, tx);
  expect(mocks.principal).not.toHaveBeenCalled();
});

it("rejects Reflections read receipts, duplicate selectors and browser credentials before recovery", async () => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const cases = [
    ["operation=reflection-task.get", {}, 404],
    [`operation=reflection-event.append&task_id=${taskId}&actor_id=caller`, {}, 404],
    [`operation=reflection-event.append&operation=reflection-event.append&task_id=${taskId}`, {}, 404],
    [`operation=reflection-event.append&task_id=${taskId}`, { authorization: "Bearer user" }, 400],
  ] as const;
  for (const [query, headers, status] of cases) {
    const response = await GET(new Request(`http://localhost/api/internal/dream/v1/receipts/original?${query}`, { headers }), { params: Promise.resolve({ requestId: "original" }) });
    expect(response.status).toBe(status);
  }
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.find).not.toHaveBeenCalled();
});
