// [Input] Frozen Registry108 prefix, Registry109 DTO, Registry114 inventory and production POST route.
// [Output] Exact historical append, contract hash, requirements, generated inventory and dispatch assertions.
// [Pos] Registration gate for story-workspace-output.store.
// [Sync] 2026-09-15: preserve Registry109 bytes while Registry114 appends later Story domains.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const name = "story-workspace-output.store" as const;
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./storyWorkspaceOutputHandler", () => ({
  isStoryWorkspaceOutputOperation: (value: string) => value === name,
  handleStoryWorkspaceOutput: mocks.handler,
}));
import generated114 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { storyWorkspaceOutputOperationContracts } from "./storyWorkspaceOutputDto";
import { storyWorkspaceOutputSchemaRequirements } from "./storyWorkspaceOutputService";
import { identitySchemaRequirement } from "./schemaRequirements";
beforeEach(() => vi.resetAllMocks());
it("preserves Registry108 and appends exactly one Registry109 atomic write", () => {
  expect(dreamOperations).toHaveLength(114); expect(generated114).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 108))).digest("hex"))
    .toBe("a631f9dbae964079af9fbd92eebd212b1d5294ebdeba9aa8e164668831352583");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 109))).digest("hex"))
    .toBe("48909feea302787bcbd0ed7a263212eeee163a0e3e7887acfda56cc2b421d513");
  const registered = dreamOperations[108]; expect(registered.contract.name).toBe(name);
  expect(registered.capability).toMatchObject({ kind: "write", user_scope: "dream:write", background_scope: null,
    contract_sha256: "2b7d9180c78829df86289d717037ddbfd20ecee517d8213e0e71b9388cee65ed" });
  expect(registered.requirements).toEqual([identitySchemaRequirement, ...storyWorkspaceOutputSchemaRequirements]);
});
it("production POST dispatches Registry109 exactly once", async () => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
  const response = new Response("domain-result"); mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});
it("keeps the live strict DTO behind one write descriptor", () => {
  const operation = storyWorkspaceOutputOperationContracts[name];
  expect(operation.kind).toBe("write"); expect(operation.userScope).toBe("dream:write");
});
