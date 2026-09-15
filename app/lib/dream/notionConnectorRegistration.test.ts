// [Input] Frozen Registry147 prefix, Notion DTOs, capabilities, generated inventory and production POST route.
// [Output] Registry148-168 append hash, scope split, requirements and dispatch assertions.
// [Pos] Registration gate for the complete Notion connector persistence domain.
// [Sync] 2026-09-16: append twenty-one operations without changing Registry147 bytes.
import { createHash } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";

const names = [
  "notion.connector.create", "notion.connector.list", "notion.connector.get", "notion.connector.active",
  "notion.connector.patch", "notion.connector.delete", "notion.auth-state.save", "notion.resources.replace",
  "notion.resources.list", "notion.resource.delete", "notion.snapshot.save", "notion.snapshot.current",
  "notion.snapshot.get", "notion.snapshot.list", "notion.thread.attach", "notion.thread.resolve",
  "notion.sync-candidates.list", "notion.sync-connector.get", "notion.sync-connector.patch",
  "notion.sync-resources.list", "notion.sync-snapshot.save",
] as const;
const nameSet = new Set<string>(names);
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./notionConnectorHandler", () => ({
  isNotionConnectorOperation: (value: string) => nameSet.has(value),
  handleNotionConnector: mocks.handler,
}));

import generated168 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { notionConnectorOperationContracts } from "./notionConnectorDto";
import { notionConnectorSchemaRequirements } from "./notionConnectorService";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());

it("preserves Registry147 and appends exactly Registry148-168", () => {
  expect(dreamOperations).toHaveLength(168);
  expect(generated168).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 147))).digest("hex"))
    .toBe("73a50db695af5170765f8473179b8a8dacd817c5c457161d75bec5b97c1e32f1");
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations)).digest("hex"))
    .toBe("5b165b20d82ba48a47ada70db497df54552ec256f673f53a977e9c177a6a1961");
  expect(dreamOperations.slice(147).map(item => item.contract.name)).toEqual(names);
  for (const operation of dreamOperations.slice(147)) {
    expect(operation.requirements).toEqual([identitySchemaRequirement, ...notionConnectorSchemaRequirements]);
  }
});

it("publishes the exact OAuth and scheduled service authority split", () => {
  for (const [name, contract] of Object.entries(notionConnectorOperationContracts)) {
    const registered = dreamOperations.find(item => item.contract.name === name)!;
    if (contract.audience === "user") {
      expect(registered.capability.user_scope).toBe(contract.kind === "read" ? "dream:read" : "dream:write");
      expect(registered.capability.background_scope).toBeNull();
    } else {
      expect(registered.capability.user_scope).toBeNull();
      expect(registered.capability.background_scope).toBe("connectors:sync");
    }
  }
});

it("dispatches every Notion operation through the dedicated handler", async () => {
  for (const name of names) {
    const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
    const response = new Response(name);
    mocks.handler.mockResolvedValueOnce(response);
    expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
    expect(mocks.handler).toHaveBeenLastCalledWith(request, name);
  }
  expect(mocks.handler).toHaveBeenCalledTimes(names.length);
});
