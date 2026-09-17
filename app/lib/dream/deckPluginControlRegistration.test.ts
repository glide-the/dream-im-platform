// [Input] Frozen Registry169 prefix, Registry170-174 DTOs, generated contract inventory and POST route.
// [Output] Append-only hashes, requirements and dedicated production dispatch evidence.
// [Pos] Registration gate for the Deck Plugin control aggregate.
// [Sync] 2026-09-16: append Registry170-174 without changing Registry169 bytes.
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./deckPluginControlHandler", () => ({
  isDeckPluginControlOperation: (value: string) => value.startsWith("deck-plugin-control."),
  handleDeckPluginControl: mocks.handler,
}));
import generated174 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { deckPluginControlSchemaRequirements } from "./deckPluginControlService";
import { identitySchemaRequirement } from "./schemaRequirements";

const names = ["deck-plugin-control.list", "deck-plugin-control.version", "deck-plugin-control.readiness",
  "deck-plugin-control.plan", "deck-plugin-control.apply"] as const;
const hashes = ["580809db8126d3f45cc233a7a4c32f38cfd19daa6cb5ccd2154cbec10ba359b2",
  "8fb594490a7766bc81aa273c2aee17e4616d22d0f0c724c718f5797d435ca589",
  "8c41de9052a5036d48f52a0945174d654b0442dd43159953978310cca0fc5fa3",
  "2e11a56d2e3efb491762cfc5559bd7a2cf1f2aee527632243424a62ef0e38df8",
  "fba707edfdad4ed88f82b8325d2cfd90a7f52f9ad24a34e07e05021c0978573e"];

beforeEach(() => vi.resetAllMocks());

it("preserves Registry169 and the exact Registry170-174 prefix", () => {
  expect(dreamOperations.length).toBeGreaterThanOrEqual(174); expect(generated174).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 169))).digest("hex"))
    .toBe("adb90cec21e76f709d9d10638642051f33b1eb04df618f6984aaffb5c4a0962e");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 174))).digest("hex"))
    .toBe("242ddb8e06c66058b4a6a0a015a08edb41353446ae00be46e6c2f1b946cf57dc");
  expect(dreamOperations.slice(169, 174).map(item => item.contract.name)).toEqual(names);
  expect(dreamOperations.slice(169, 174).map(item => item.capability.contract_sha256)).toEqual(hashes);
  for (const operation of dreamOperations.slice(169, 174)) {
    expect(operation.requirements).toEqual([identitySchemaRequirement, ...deckPluginControlSchemaRequirements]);
    expect(operation.capability.background_scope).toBeNull();
  }
});

it("dispatches Registry170-174 through the dedicated handler", async () => {
  const request = new Request("http://localhost/api/internal/dream/v1/operations/deck-plugin-control.plan", { method: "POST" });
  const response = new Response("planned"); mocks.handler.mockResolvedValue(response);
  expect(await POST(request, { params: Promise.resolve({ operation: "deck-plugin-control.plan" }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, "deck-plugin-control.plan");
});
