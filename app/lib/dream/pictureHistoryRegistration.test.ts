// [Input] Frozen Registry101 prefix, live Registry103 DTOs and production POST route.
// [Output] Exact two-read append, OAuth dispatch, capability and no-receipt registration evidence.
// [Pos] Registration gate for picture-history.list and picture-history.full.
// [Sync] 2026-09-15: Registry111 extends only the total-length guard; this file still owns its frozen segment.
// [Sync] 2026-09-15: retain Registry103 assertions after the independent Registry106 append.
// [Sync] 2026-09-15: Registry108 extends only the total-length guard; this file still owns its original frozen segment.
import { beforeEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

const names = ["picture-history.list", "picture-history.full"] as const;
const mocks = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock("./pictureHistoryHandler", () => ({
  isPictureHistoryOperation: (name: string) => names.includes(name as typeof names[number]),
  handlePictureHistory: mocks.handler,
}));

import generated103 from "../../../docs/architecture/admin-dream-operation-contracts.json";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { canonicalContractJson, dreamOperations } from "./operationRegistry";
import { pictureHistoryOperationContracts } from "./pictureHistoryDto";
import { pictureHistorySchemaRequirements } from "./pictureHistoryService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => vi.resetAllMocks());

it("preserves the complete Registry101 prefix and appends exactly two OAuth reads as Registry103", () => {
  expect(dreamOperations).toHaveLength(111);
  expect(generated103).toEqual(dreamOperations);
  expect(createHash("sha256").update(canonicalContractJson(dreamOperations.slice(0, 101))).digest("hex")).toBe("8964d7dea090d83bf2795b1b0e1c1fc23da293b80182428c7bec7ebc9ded8147");
  expect(dreamOperations.slice(101, 103).map(item => item.contract.name)).toEqual(names);
  for (const item of dreamOperations.slice(101, 103)) {
    expect(item.capability).toMatchObject({ kind: "read", user_scope: "dream:read", background_scope: null });
    expect(item.requirements).toEqual([identitySchemaRequirement, ...pictureHistorySchemaRequirements]);
  }
});

it.each(names)("production POST dispatches %s exactly once", async name => {
  const request = new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST" }), response = new Response("domain-result");
  mocks.handler.mockResolvedValueOnce(response);
  expect(await POST(request, { params: Promise.resolve({ operation: name }) })).toBe(response);
  expect(mocks.handler).toHaveBeenCalledExactlyOnceWith(request, name);
});

it("keeps the two live DTO contracts behind read-only descriptors", () => {
  for (const [name, operation] of Object.entries(pictureHistoryOperationContracts)) {
    const registered = dreamOperations.find(item => item.contract.name === name);
    expect(registered?.capability.contract_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(operation.kind).toBe("read"); expect(operation.userScope).toBe("dream:read");
  }
});
