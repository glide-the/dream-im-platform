// [Input] Frozen Registry114 prefix, live Registry115 guidance DTO, schema capability and production POST route.
// [Output] Exact append hash, requirements, scope, generated inventory and dispatch assertions.
// [Pos] Registration gate for the Story Workspace guidance business operation.
// [Sync] 2026-09-15: append guidance persistence without changing Registry114 bytes.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const names = new Set(["story-workspace-guidance.submit"]);
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./storyWorkspaceGuidanceHandler", () => ({
  isStoryWorkspaceGuidanceOperation: (value: string) => names.has(value),
  handleStoryWorkspaceGuidance: mocks.handler,
}));
import generated115 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { storyWorkspaceGuidanceOperationContracts } from "./storyWorkspaceGuidanceDto";
import { storyWorkspaceGuidanceSchemaRequirements } from "./storyWorkspaceGuidanceService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());
it("preserves Registry114 and appends exactly one Registry115 operation", () => {
  expect(dreamOperations).toHaveLength(115); expect(generated115).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 114))).digest("hex"))
    .toBe("dc80b77410aac58528dde77578154d9848d9dfc3bf55de4a35c8c315a81af704");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations)).digest("hex"))
    .toBe("58ab3cd933165dca7d6ae2d6eb50f46ff8f148e8e7eaf3dd5e46ceab1ad2ba9b");
  expect(dreamOperations[114].capability.contract_sha256).toBe("a061ed38d2ca10073bbb7fd078e679f072f0cbd4ff1ce900792fbf8725223727");
  expect(dreamOperations[114].requirements).toEqual([identitySchemaRequirement, ...storyWorkspaceGuidanceSchemaRequirements]);
});

it("production POST dispatches guidance exactly once", async () => {
  const name = "story-workspace-guidance.submit";
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
  const response = new Response("guidance-result"); mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it("publishes one OAuth write contract", () => {
  expect(Object.keys(storyWorkspaceGuidanceOperationContracts)).toEqual([...names]);
  expect(storyWorkspaceGuidanceOperationContracts["story-workspace-guidance.submit"])
    .toMatchObject({ kind: "write", userScope: "dream:write" });
});
