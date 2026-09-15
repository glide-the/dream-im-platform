// [Input] Frozen Registry120 prefix, claim-turn contract, schema requirement and production route.
// [Output] Exact Registry121 prefix hash, audience, scope and fixed-name dispatch assertions.
// [Pos] Registration gate for claim-fenced confirmation Runtime persistence.
// [Sync] 2026-09-16: preserve the frozen Registry121 prefix as later operations append.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const names = new Set([
  "story-workspace-confirmation.submit", "story-workspace-confirmation.fact",
  "story-workspace-confirmation.claim", "story-workspace-confirmation.lease",
  "story-workspace-confirmation.ack", "story-workspace-confirmation.claim-turn",
]);
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./storyWorkspaceConfirmationHandler", () => ({
  isStoryWorkspaceConfirmationOperation: (value: string) => names.has(value),
  handleStoryWorkspaceConfirmation: mocks.handler,
}));
import generatedRegistry from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { storyWorkspaceConfirmationOperationContracts } from "./storyWorkspaceConfirmationDto";
import { storyWorkspaceConfirmationRequirements } from "./storyWorkspaceConfirmationService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());
it("preserves Registry120 and the exact Registry121 prefix", () => {
  const registry121 = dreamOperations.slice(0, 121);
  expect(dreamOperations.length).toBeGreaterThanOrEqual(121);
  expect(generatedRegistry).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(registry121.slice(0, 120))).digest("hex"))
    .toBe("4b0bbfa8caecd42acf0ecc89be4153b6d6fb1e124aac4ff27e937ecb14904795");
  expect(createHash("sha256").update(canonicalContractJson(registry121)).digest("hex"))
    .toBe("969d316b62c1c77aa5f232030d882fd48b36f01b0728cd4f86b877caa99909af");
  expect(registry121.slice(115).map(item => item.capability.contract_sha256)).toEqual([
    "2571aa2cc9c19656c4ac90d33221da65e8a631657adebf9f535ab0fe3c76bb12",
    "f455a6075161751d25a229dd64479e2a6d6ca781ea7aacfa5575ec4561f52beb",
    "c049317c4383584a7574b11daea1b8c626875d589e0dbbd45dfb739c4ca8cde1",
    "a5720992e5a0cbc39773481dd3f98a32e6b535c34ea24df230de6ad5646817e6",
    "12aeed9beb6584354aa584ebadf7ce352d68084632c0d2c90a2c768c3a8626c6",
    "c971b5f2ee3517eb9c078d70544bfaa46d74a293afc44b1b8386496d9d081e62",
  ]);
  for (const item of registry121.slice(115)) {
    expect(item.requirements).toEqual([
      identitySchemaRequirement,
      ...storyWorkspaceConfirmationRequirements(item.contract.name as keyof typeof storyWorkspaceConfirmationOperationContracts),
    ]);
  }
});

it("publishes two OAuth and four exact service-scope operations", () => {
  expect(Object.keys(storyWorkspaceConfirmationOperationContracts)).toEqual([...names]);
  expect(dreamOperations.slice(115, 121).map(item => ({
    name: item.contract.name,
    user: item.capability.user_scope,
    background: item.capability.background_scope,
  }))).toEqual([
    { name: "story-workspace-confirmation.submit", user: "dream:write", background: null },
    { name: "story-workspace-confirmation.fact", user: "dream:read", background: null },
    { name: "story-workspace-confirmation.claim", user: null, background: "story-confirmation:dispatch" },
    { name: "story-workspace-confirmation.lease", user: null, background: "story-confirmation:dispatch" },
    { name: "story-workspace-confirmation.ack", user: null, background: "story-confirmation:dispatch" },
    { name: "story-workspace-confirmation.claim-turn", user: null, background: "story-confirmation:dispatch" },
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
