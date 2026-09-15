// [Input] Frozen Registry105 prefix, live Registry106 DTO and production POST route.
// [Output] Exact append, OAuth/Thread dispatch, capability and generated-artifact parity evidence.
// [Pos] Registration gate for deck-workspace-plugins.resolve.
// [Sync] 2026-09-15: append one metadata read without changing Registry105 bytes.
// [Sync] 2026-09-15: Registry108 extends only the total-length guard; this file still owns its original frozen segment.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const name = "deck-workspace-plugins.resolve" as const;
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./deckWorkspacePluginsHandler", () => ({
  isDeckWorkspacePluginsOperation: (value: string) => value === name,
  handleDeckWorkspacePlugins: mocks.handler,
}));

import generated107 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { deckWorkspacePluginsOperationContracts } from "./deckWorkspacePluginsDto";
import { deckWorkspacePluginsSchemaRequirements } from "./deckWorkspacePluginsService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());

it("preserves Registry105 and appends exactly one Registry106 read", () => {
  expect(dreamOperations).toHaveLength(108);
  expect(generated107).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 105))).digest("hex")).toBe("45c7723be490908d178a073b2272f11e29815cd8f3a7f055c457e94a21f7d49b");
  expect(dreamOperations.slice(105, 106).map(item => item.contract.name)).toEqual([name]);
  const registered = dreamOperations[105];
  expect(registered.capability).toMatchObject({ kind: "read", user_scope: "dream:read", background_scope: null });
  expect(registered.capability.contract_sha256).toBe("79eca8295a3a1611b2459af26f0a9e05dd01eae97bdd4928d1982e77a524425e");
  expect(registered.requirements).toEqual([identitySchemaRequirement, ...deckWorkspacePluginsSchemaRequirements]);
});

it("production POST dispatches Registry106 exactly once", async () => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
  const response = new Response("domain-result"); mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it("keeps the live strict DTO behind one read-only descriptor", () => {
  const operation = deckWorkspacePluginsOperationContracts[name];
  expect(operation.kind).toBe("read"); expect(operation.userScope).toBe("dream:read");
});
