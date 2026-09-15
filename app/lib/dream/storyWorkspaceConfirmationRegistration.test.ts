// [Input] Frozen Registry115 prefix, five confirmation contracts, schema requirement and production route.
// [Output] Exact Registry120 hashes, audiences, scopes and fixed-name dispatch assertions.
// [Pos] Registration gate for the complete Story Workspace confirmation database state machine.
// [Sync] 2026-09-16: append five operations without changing Registry115 bytes.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const names = new Set([
  "story-workspace-confirmation.submit", "story-workspace-confirmation.fact",
  "story-workspace-confirmation.claim", "story-workspace-confirmation.lease",
  "story-workspace-confirmation.ack",
]);
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./storyWorkspaceConfirmationHandler", () => ({
  isStoryWorkspaceConfirmationOperation: (value: string) => names.has(value),
  handleStoryWorkspaceConfirmation: mocks.handler,
}));
import generated120 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { storyWorkspaceConfirmationOperationContracts } from "./storyWorkspaceConfirmationDto";
import { storyWorkspaceConfirmationSchemaRequirements } from "./storyWorkspaceConfirmationService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());
it("preserves Registry115 and appends exactly five Registry120 operations", () => {
  expect(dreamOperations).toHaveLength(120);
  expect(generated120).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 115))).digest("hex"))
    .toBe("58ab3cd933165dca7d6ae2d6eb50f46ff8f148e8e7eaf3dd5e46ceab1ad2ba9b");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations)).digest("hex"))
    .toBe("4b0bbfa8caecd42acf0ecc89be4153b6d6fb1e124aac4ff27e937ecb14904795");
  expect(dreamOperations.slice(115).map(item => item.capability.contract_sha256)).toEqual([
    "2571aa2cc9c19656c4ac90d33221da65e8a631657adebf9f535ab0fe3c76bb12",
    "f455a6075161751d25a229dd64479e2a6d6ca781ea7aacfa5575ec4561f52beb",
    "c049317c4383584a7574b11daea1b8c626875d589e0dbbd45dfb739c4ca8cde1",
    "a5720992e5a0cbc39773481dd3f98a32e6b535c34ea24df230de6ad5646817e6",
    "12aeed9beb6584354aa584ebadf7ce352d68084632c0d2c90a2c768c3a8626c6",
  ]);
  for (const item of dreamOperations.slice(115)) {
    expect(item.requirements).toEqual([identitySchemaRequirement, ...storyWorkspaceConfirmationSchemaRequirements]);
  }
});

it("publishes two OAuth and three exact service-scope operations", () => {
  expect(Object.keys(storyWorkspaceConfirmationOperationContracts)).toEqual([...names]);
  expect(dreamOperations.slice(115).map(item => ({
    name: item.contract.name,
    user: item.capability.user_scope,
    background: item.capability.background_scope,
  }))).toEqual([
    { name: "story-workspace-confirmation.submit", user: "dream:write", background: null },
    { name: "story-workspace-confirmation.fact", user: "dream:read", background: null },
    { name: "story-workspace-confirmation.claim", user: null, background: "story-confirmation:dispatch" },
    { name: "story-workspace-confirmation.lease", user: null, background: "story-confirmation:dispatch" },
    { name: "story-workspace-confirmation.ack", user: null, background: "story-confirmation:dispatch" },
  ]);
});

it("production POST dispatches a confirmation operation exactly once", async () => {
  const name = "story-workspace-confirmation.claim";
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
  const response = new Response("confirmation-result");
  mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});
