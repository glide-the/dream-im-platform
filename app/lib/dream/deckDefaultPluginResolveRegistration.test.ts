// [Sync] 2026-09-16: keep this frozen Registry104 segment append-safe through Registry121.
// [Input] Frozen Registry103 prefix, live Registry104 DTO and production POST route.
// [Output] Exact one-read append, OAuth dispatch, capability and artifact parity evidence.
// [Pos] Registration gate for deck.default-plugin.resolve.
// [Sync] 2026-09-15: Registry115 extends only the total-length guard; this file still owns its frozen segment.
// [Sync] 2026-09-15: keep the Registry104 slot stable after Registry106 appends independently.
// [Sync] 2026-09-15: Registry108 extends only the total-length guard; this file still owns its original frozen segment.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const name = "deck.default-plugin.resolve" as const;
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./deckDefaultPluginResolveHandler", () => ({
  isDeckDefaultPluginResolveOperation: (value: string) => value === name,
  handleDeckDefaultPluginResolve: mocks.handler,
}));

import generated104 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { deckDefaultPluginResolveOperationContracts } from "./deckDefaultPluginResolveDto";
import { deckDefaultPluginResolveSchemaRequirements } from "./deckDefaultPluginResolveService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());

it("preserves the complete Registry103 prefix and appends exactly one OAuth read as Registry104", () => {
  expect(dreamOperations.length).toBeGreaterThanOrEqual(104);
  expect(generated104).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 103))).digest("hex")).toBe("b47e731abee6fd0a9b937333f9535817a5d7ffffe0a012440123fde6d6f6c824");
  expect(dreamOperations.slice(103, 104).map(item => item.contract.name)).toEqual([name]);
  const registered = dreamOperations[103];
  expect(registered.capability).toMatchObject({ kind: "read", user_scope: "dream:read", background_scope: null });
  expect(registered.requirements).toEqual([identitySchemaRequirement, ...deckDefaultPluginResolveSchemaRequirements]);
});

it("production POST dispatches the operation exactly once", async () => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" }), response = new Response("domain-result");
  mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it("keeps the live strict DTO behind one read-only descriptor", () => {
  const operation = deckDefaultPluginResolveOperationContracts[name];
  const registered = dreamOperations.find(item => item.contract.name === name);
  expect(registered?.capability.contract_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(operation.kind).toBe("read"); expect(operation.userScope).toBe("dream:read");
});
