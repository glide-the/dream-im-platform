// [Input] Frozen Registry168 prefix, Registry169 DTOs, generated inventory and POST route.
// [Output] Append hash, requirement and production dispatch evidence.
// [Pos] Registration gate for auto-repair message settlement.
// [Sync] 2026-09-16: append Registry169 without changing Registry168 bytes.
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./dreamAutoRepairHandler", () => ({
  isDreamAutoRepairOperation: (value: string) => value === "dream-auto-repair.settle",
  handleDreamAutoRepair: mocks.handler,
}));
import generated169 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { dreamAutoRepairSchemaRequirements } from "./dreamAutoRepairService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());

it("preserves Registry168 and appends exactly Registry169", () => {
  expect(dreamOperations).toHaveLength(169);
  expect(generated169).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 168))).digest("hex"))
    .toBe("5b165b20d82ba48a47ada70db497df54552ec256f673f53a977e9c177a6a1961");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations)).digest("hex"))
    .toBe("adb90cec21e76f709d9d10638642051f33b1eb04df618f6984aaffb5c4a0962e");
  expect(dreamOperations[168]).toMatchObject({
    contract: { name: "dream-auto-repair.settle" },
    capability: { kind: "write", user_scope: "dream:write", background_scope: null,
      contract_sha256: "155adcb6995b63e090cbc2906383ba4b78525c1f268a430ad6f2ba449b66b159" },
    requirements: [identitySchemaRequirement, ...dreamAutoRepairSchemaRequirements],
  });
});

it("dispatches Registry169 through the dedicated handler", async () => {
  const request = new Request("http://localhost/api/internal/dream/v1/operations/dream-auto-repair.settle", { method: "POST" });
  const response = new Response("settled"); mocks.handler.mockResolvedValue(response);
  expect(await POST(request, { params: Promise.resolve({ operation: "dream-auto-repair.settle" }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, "dream-auto-repair.settle");
});
