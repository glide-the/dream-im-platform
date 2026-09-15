// [Input] Frozen Registry132 prefix, Registry133 replay DTO and production operation route.
// [Output] Exact frozen-prefix hashes, scopes, requirements and generated inventory parity from Registry133 onward.
// [Pos] Registration gate for eleven Deck Plugin, Agent-type and launch Runtime operations.
// [Sync] 2026-09-16: freeze Registry133 while allowing later append-only operations.
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const names = new Set(["deck-plugin-binding.current", "deck-plugin-binding.history", "deck-plugin-binding.options", "deck-plugin-binding.validate", "deck-plugin-binding.save", "deck-plugin-binding.clear", "deck-agent-type.runtime-plan", "deck-agent-type.runtime-prepare", "dream-launch.runtime-scope", "dream-launch.runtime-plan", "dream-launch.runtime-prepare"]);
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./deckPluginBindingHandler", () => ({ isDeckPluginBindingOperation: (name: string) => names.has(name), handleDeckPluginBinding: mocks.handler }));
import generated133 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { deckPluginBindingOperationContracts } from "./deckPluginBindingDto";
import { deckPluginBindingSchemaRequirements } from "./deckPluginBindingService";
import { identitySchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";

beforeEach(() => vi.resetAllMocks());
it("preserves Registry129 and appends the three exact launch Runtime contracts", () => {
  expect(dreamOperations.length).toBeGreaterThanOrEqual(133); expect(generated133).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 129))).digest("hex")).toBe("686f0668c72ca6114d894392d2dd2a2fde228b87fa31a1b858fd1dd553663881");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 132))).digest("hex")).toBe("6e0149b3d3354d081564af21349f364cc092087d5aadce0d5164654a6c005bb2");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 133))).digest("hex")).toBe("951a3ee9d26354d0094dafec6233a13638a430672ddacd730cefc95f654b5ec3");
  expect(dreamOperations.slice(121, 132).map(item => item.contract.name)).toEqual([...names]);
  expect(dreamOperations.slice(121, 132).every(item => JSON.stringify(item.requirements) === JSON.stringify([identitySchemaRequirement, ...deckPluginBindingSchemaRequirements]))).toBe(true);
  expect(dreamOperations[132]).toMatchObject({ contract: { name: "dream-launch-replay.lookup" },
    capability: { kind: "read", user_scope: "dream:read" }, requirements: [identitySchemaRequirement, dreamUnifiedSchemaRequirement] });
});
it("dispatches every new operation before the generic route", async () => {
  for (const name of names) {
    const request = new Request(`http://localhost/operations/${name}`, { method: "POST" }); const expected = new Response(name); mocks.handler.mockResolvedValueOnce(expected);
    expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(expected); expect(mocks.handler).toHaveBeenLastCalledWith(request, name);
  }
});
it("publishes seven OAuth reads and four receipt-backed writes", () => {
  expect(Object.values(deckPluginBindingOperationContracts).filter(item => item.kind === "read")).toHaveLength(7);
  expect(Object.values(deckPluginBindingOperationContracts).filter(item => item.kind === "write")).toHaveLength(4);
  expect(deckPluginBindingOperationContracts["deck-plugin-binding.save"]).toMatchObject({ kind: "write", userScope: "dream:write" });
  expect(deckPluginBindingOperationContracts["deck-agent-type.runtime-plan"]).toMatchObject({ kind: "read", userScope: "dream:read" });
  expect(deckPluginBindingOperationContracts["deck-agent-type.runtime-prepare"]).toMatchObject({ kind: "write", userScope: "dream:write" });
  expect(deckPluginBindingOperationContracts["dream-launch.runtime-scope"]).toMatchObject({ kind: "read", userScope: "dream:read" });
  expect(deckPluginBindingOperationContracts["dream-launch.runtime-plan"]).toMatchObject({ kind: "read", userScope: "dream:read" });
  expect(deckPluginBindingOperationContracts["dream-launch.runtime-prepare"]).toMatchObject({ kind: "write", userScope: "dream:write" });
});
