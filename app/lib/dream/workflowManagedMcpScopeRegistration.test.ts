// [Input] Frozen Registry106 prefix, live Registry107 DTO and production POST route.
// [Output] Exact append, capability hash, requirements and dispatch evidence.
// [Pos] Registration gate for workflow-managed-mcp-scope.resolve.
// [Sync] 2026-09-15: Registry115 extends only the total-length guard; this file still owns its frozen segment.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const name = "workflow-managed-mcp-scope.resolve" as const;
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./workflowManagedMcpScopeHandler", () => ({ isWorkflowManagedMcpScopeOperation: (value: string) => value === name, handleWorkflowManagedMcpScope: mocks.handler }));

import generated107 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { workflowManagedMcpScopeOperationContracts } from "./workflowManagedMcpScopeDto";
import { workflowManagedMcpScopeSchemaRequirements } from "./workflowManagedMcpScopeService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());

it("preserves Registry106 and appends exactly one Registry107 read", () => {
  expect(dreamOperations).toHaveLength(115); expect(generated107).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 106))).digest("hex")).toBe("f2076b75b446446bbed747c80ea7c7859f6c9ed9b602ef9fd28c332b220ada1a");
  const registered = dreamOperations[106]; expect(registered.contract.name).toBe(name);
  expect(registered.capability).toMatchObject({ kind: "read", user_scope: "dream:read", background_scope: null, contract_sha256: "c996f3bf5fc2bfcc8fa9a7c3b90ae039800109a56ec2159882cfd921d6f74bdc" });
  expect(registered.requirements).toEqual([identitySchemaRequirement, ...workflowManagedMcpScopeSchemaRequirements]);
});

it("production POST dispatches Registry107 exactly once", async () => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
  const response = new Response("domain-result"); mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it("keeps the live strict DTO behind one read-only descriptor", () => {
  const operation = workflowManagedMcpScopeOperationContracts[name]; expect(operation.kind).toBe("read"); expect(operation.userScope).toBe("dream:read");
});
