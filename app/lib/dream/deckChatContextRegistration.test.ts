// [Input] Frozen Registry104 prefix, live Registry105 DTO and production POST route.
// [Output] Exact one-read append, OAuth dispatch, capability and generated-artifact parity evidence.
// [Pos] Registration gate for deck-chat-context.resolve.
// [Sync] 2026-09-15: Registry109 extends only the total-length guard; this file still owns its frozen segment.
// [Sync] 2026-09-15: Registry108 extends only the total-length guard; this file still owns its original frozen segment.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const name = "deck-chat-context.resolve" as const;
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./deckChatContextHandler", () => ({
  isDeckChatContextOperation: (value: string) => value === name,
  handleDeckChatContext: mocks.handler,
}));

import generated106 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { deckChatContextOperationContracts } from "./deckChatContextDto";
import { deckChatContextSchemaRequirements } from "./deckChatContextService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());

it("preserves the complete Registry104 prefix and appends exactly one OAuth read as Registry105", () => {
  expect(dreamOperations).toHaveLength(109);
  expect(generated106).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 104))).digest("hex")).toBe("84134aa00070e3a5838435742a5c2a2a966914225d45a85674da058e3cd8070e");
  expect(dreamOperations.slice(104, 105).map(item => item.contract.name)).toEqual([name]);
  const registered = dreamOperations[104];
  expect(registered.capability).toMatchObject({
    kind: "read", user_scope: "dream:read", background_scope: null,
    contract_sha256: "c956db969d76208bd99d2d8ad2c9e7eb2f6154d835388424e7db5ca09ca74b97",
  });
  expect(registered.requirements).toEqual([identitySchemaRequirement, ...deckChatContextSchemaRequirements]);
});

it("production POST dispatches the operation exactly once", async () => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" });
  const response = new Response("domain-result");
  mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it("keeps the live strict DTO behind one read-only descriptor", () => {
  const operation = deckChatContextOperationContracts[name];
  const registered = dreamOperations.find(item => item.contract.name === name);
  expect(registered?.capability.contract_sha256).toBe("c956db969d76208bd99d2d8ad2c9e7eb2f6154d835388424e7db5ca09ca74b97");
  expect(operation.kind).toBe("read");
  expect(operation.userScope).toBe("dream:read");
});
