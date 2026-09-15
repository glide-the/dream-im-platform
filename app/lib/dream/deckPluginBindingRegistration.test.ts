// [Input] Frozen Registry121 prefix, Registry122-126 binding DTOs and production operation route.
// [Output] Exact append hashes, scopes, requirements and generated inventory parity.
// [Pos] Registration gate for five Deck Plugin binding operations.
// [Sync] 2026-09-16: append Registry122-126 without changing Registry121 bytes.
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const names = new Set(["deck-plugin-binding.current", "deck-plugin-binding.history", "deck-plugin-binding.options", "deck-plugin-binding.validate", "deck-plugin-binding.save"]);
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./deckPluginBindingHandler", () => ({ isDeckPluginBindingOperation: (name: string) => names.has(name), handleDeckPluginBinding: mocks.handler }));
import generated126 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { deckPluginBindingOperationContracts } from "./deckPluginBindingDto";
import { deckPluginBindingSchemaRequirements } from "./deckPluginBindingService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());
it("preserves Registry121 and appends the five exact binding contracts", () => {
  expect(dreamOperations).toHaveLength(126); expect(generated126).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 121))).digest("hex")).toBe("969d316b62c1c77aa5f232030d882fd48b36f01b0728cd4f86b877caa99909af");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations)).digest("hex")).toBe("67a18f69f0674270c5f316959a7d962ef7a8c201249f4c45ac3a780ed710eada");
  expect(dreamOperations.slice(121).map(item => item.contract.name)).toEqual([...names]);
  expect(dreamOperations.slice(121).every(item => JSON.stringify(item.requirements) === JSON.stringify([identitySchemaRequirement, ...deckPluginBindingSchemaRequirements]))).toBe(true);
});
it("dispatches every new operation before the generic route", async () => {
  for (const name of names) {
    const request = new Request(`http://localhost/operations/${name}`, { method: "POST" }); const expected = new Response(name); mocks.handler.mockResolvedValueOnce(expected);
    expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(expected); expect(mocks.handler).toHaveBeenLastCalledWith(request, name);
  }
});
it("publishes four reads and one OAuth write", () => {
  expect(Object.values(deckPluginBindingOperationContracts).filter(item => item.kind === "read")).toHaveLength(4);
  expect(deckPluginBindingOperationContracts["deck-plugin-binding.save"]).toMatchObject({ kind: "write", userScope: "dream:write" });
});
