// [Sync] 2026-09-16: preserve this frozen segment while Registry120 appends confirmation operations.
// [Input] Frozen Registry111 prefix, live Registry114 catalog DTOs, schema capability, inventory, and POST route.
// [Output] Exact append hashes, requirements, scopes, generated inventory, and dispatch assertions.
// [Pos] Registration gate for the three Story Workspace catalog business operations.
// [Sync] 2026-09-15: preserve the exact Registry114 catalog segment while Registry115 appends guidance.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const names = new Set([
  "story-workspace-catalog.workspace", "story-workspace-catalog.read", "story-workspace-catalog.patch",
]);
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./storyWorkspaceCatalogHandler", () => ({
  isStoryWorkspaceCatalogOperation: (value: string) => names.has(value),
  handleStoryWorkspaceCatalog: mocks.handler,
}));
import generated115 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { storyWorkspaceCatalogOperationContracts } from "./storyWorkspaceCatalogDto";
import { storyWorkspaceCatalogSchemaRequirements } from "./storyWorkspaceCatalogService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());
it("preserves the exact three-operation Registry114 segment", () => {
  expect(dreamOperations).toHaveLength(120); expect(generated115).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 111))).digest("hex"))
    .toBe("01f1a9ffbd9daf44e9bc640768a13ae636d9e718cb42365ff2de1ba5c244efc3");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 114))).digest("hex"))
    .toBe("dc80b77410aac58528dde77578154d9848d9dfc3bf55de4a35c8c315a81af704");
  expect(dreamOperations.slice(111, 114).map(item => item.capability.contract_sha256)).toEqual([
    "3fbd32dd7343ae5008d7f71f2475db1b022a95060f2544b9dfbea606af894965",
    "317ed15c2f827c44099e0641693d3dcf09bc01186e26586a9b2281226faa142b",
    "0ef2cc94d01d488c46a9872efb389b43890e9267460705ebee33ac5ab47180cd",
  ]);
  for (const registered of dreamOperations.slice(111, 114)) expect(registered.requirements)
    .toEqual([identitySchemaRequirement, ...storyWorkspaceCatalogSchemaRequirements]);
});

it.each([...names])("production POST dispatches %s exactly once", async name => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
  const response = new Response("catalog-result"); mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it("publishes one read and two write contracts with exact OAuth scopes", () => {
  expect(Object.keys(storyWorkspaceCatalogOperationContracts)).toEqual([...names]);
  expect(storyWorkspaceCatalogOperationContracts["story-workspace-catalog.read"])
    .toMatchObject({ kind: "read", userScope: "dream:read" });
  for (const name of ["story-workspace-catalog.workspace", "story-workspace-catalog.patch"] as const)
    expect(storyWorkspaceCatalogOperationContracts[name]).toMatchObject({ kind: "write", userScope: "dream:write" });
});
