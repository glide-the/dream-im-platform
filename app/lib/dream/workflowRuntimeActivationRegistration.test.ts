// [Input] Frozen Registry107 prefix, live Registry108 DTO, schema capability and production POST route.
// [Output] Exact append, contract hash, requirements, generated inventory and dispatch assertions.
// [Pos] Registration gate for workflow-runtime.activate.
// [Sync] 2026-09-15: Registry111 extends only the total-length guard; this file still owns its frozen segment.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const name = "workflow-runtime.activate" as const;
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./workflowRuntimeActivationHandler", () => ({
  isWorkflowRuntimeActivationOperation: (value: string) => value === name,
  handleWorkflowRuntimeActivation: mocks.handler,
}));

import generated108 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { workflowRuntimeActivationOperationContracts } from "./workflowRuntimeActivationDto";
import { workflowRuntimeActivationSchemaRequirements } from "./workflowRuntimeActivationService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());

it("preserves Registry107 and appends exactly one Registry108 atomic write", () => {
  expect(dreamOperations).toHaveLength(111); expect(generated108).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 107))).digest("hex"))
    .toBe("d636ba4be69279e0e0d9bf84a249c61c1c02635798cb1ab2c56cb6bd42ed4a20");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 108))).digest("hex"))
    .toBe("a631f9dbae964079af9fbd92eebd212b1d5294ebdeba9aa8e164668831352583");
  const registered = dreamOperations[107]; expect(registered.contract.name).toBe(name);
  expect(registered.capability).toMatchObject({ kind: "write", user_scope: "dream:write", background_scope: null,
    contract_sha256: "50a35aa706efc3f9515b5ff72b52b49c9a7ab2f5e34de959377c2c67fb054d1f" });
  expect(registered.requirements).toEqual([identitySchemaRequirement, ...workflowRuntimeActivationSchemaRequirements]);
});

it("production POST dispatches Registry108 exactly once", async () => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
  const response = new Response("domain-result"); mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it("keeps the live strict DTO behind one write descriptor", () => {
  const operation = workflowRuntimeActivationOperationContracts[name];
  expect(operation.kind).toBe("write"); expect(operation.userScope).toBe("dream:write");
});
