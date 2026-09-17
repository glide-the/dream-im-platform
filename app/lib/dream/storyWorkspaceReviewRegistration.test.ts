// [Sync] 2026-09-16: keep this frozen Registry111 segment append-safe through Registry121.
// [Input] Frozen Registry109/111 prefixes, live review DTOs, Registry115 inventory and production POST route.
// [Output] Exact append, hashes, generated inventory and dispatch assertions.
// [Pos] Registration gate for the two Story Workspace product-review writes.
// [Sync] 2026-09-15: preserve the two Registry111 DTO/ORM operations while Registry114 appends catalog operations.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const names = new Set(["story-workspace-review.transition", "story-workspace-review.batch"]);
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./storyWorkspaceReviewHandler", () => ({
  isStoryWorkspaceReviewOperation: (value: string) => names.has(value),
  handleStoryWorkspaceReview: mocks.handler,
}));
import generated115 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { storyWorkspaceReviewOperationContracts } from "./storyWorkspaceReviewDto";
import { storyWorkspaceReviewSchemaRequirements } from "./storyWorkspaceReviewService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());
it("preserves Registry109 and appends exactly two Registry111 writes", () => {
  expect(dreamOperations.length).toBeGreaterThanOrEqual(111); expect(generated115).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 109))).digest("hex"))
    .toBe("48909feea302787bcbd0ed7a263212eeee163a0e3e7887acfda56cc2b421d513");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 111))).digest("hex"))
    .toBe("01f1a9ffbd9daf44e9bc640768a13ae636d9e718cb42365ff2de1ba5c244efc3");
  expect(dreamOperations.slice(109, 111).map(item => item.capability.contract_sha256)).toEqual([
    "9f741208c6096b38f414fc5fb7c53d045d771233055dd68005571e7b47392392",
    "621206fde4e9322a042940e45234fadfa4bbe01ba5febea67faf7d2ad0050667",
  ]);
  for (const registered of dreamOperations.slice(109, 111)) expect(registered.requirements)
    .toEqual([identitySchemaRequirement, ...storyWorkspaceReviewSchemaRequirements]);
});

it.each([...names])("production POST dispatches %s exactly once", async name => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
  const response = new Response("review-result"); mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it("keeps both live strict DTOs behind named write descriptors", () => {
  expect(Object.keys(storyWorkspaceReviewOperationContracts)).toEqual([...names]);
  for (const operation of Object.values(storyWorkspaceReviewOperationContracts))
    expect(operation).toMatchObject({ kind: "write", userScope: "dream:write" });
});
