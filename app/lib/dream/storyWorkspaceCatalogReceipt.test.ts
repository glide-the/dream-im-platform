// [Input] Registry114 original catalog write request ID plus current OAuth actor.
// [Output] Strict committed/absent catalog evidence; catalog reads have no receipt endpoint.
// [Pos] Provider-free unknown-COMMIT recovery ingress test; it never reissues the write.
// [Sync] 2026-09-15: validate OAuth-only Story Workspace catalog write receipts.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), find: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./receipts", () => ({ ReceiptRepository: class { find = mocks.find; } }));

import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { AuthBoundaryError } from "../auth/config";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceCatalogSchemaRequirements } from "./storyWorkspaceCatalogService";

const requestId = "catalog-original";
const time = "2026-09-15T01:02:03.000Z";
const workspaceResult = { action: "ensure", item: { id: "workspace-1", name: "默认工作区",
  settings: {}, created_at: time, updated_at: time } };
const characterResult = { resource_type: "character", item: {
  id: "character-1", identifier: "character-one", name: "林小雨", avatar_url: null,
  identity: "咖啡师", personality: null, background: null, catchphrase: null, tags: ["温柔"],
  story_count: 1, review_status: "pending", review_notes: null, status: "active",
  created_at: time, updated_at: time, confirmed_at: null, archived_at: null,
} };
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" as const };
function read(operation: string, token = "oauth", suffix = "") {
  return GET(new Request(
    `http://localhost/api/internal/dream/v1/receipts/${requestId}?operation=${operation}${suffix}`,
    { headers: { authorization: `Bearer ${token}` } },
  ), { params: Promise.resolve({ requestId }) });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.service.mockReturnValue({ id: "dream-service" });
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
});

it.each([
  ["story-workspace-catalog.workspace", workspaceResult],
  ["story-workspace-catalog.patch", characterResult],
] as const)("recovers the exact committed %s DTO under OAuth", async (operation, result) => {
  const receipt = { inputSha256: "a".repeat(64), result,
    threadScope: null, editorSessionScope: null, runScope: null };
  mocks.find.mockResolvedValue(receipt);
  const response = await read(operation);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "committed", operation,
    request_id: requestId, result }, request_id: requestId });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([
    identitySchemaRequirement, ...storyWorkspaceCatalogSchemaRequirements,
  ]);
  expect(mocks.principal).toHaveBeenCalledWith({ marker: "tx" }, "oauth", { id: "dream-service" }, "dream:write");
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith(operation, requestId);
});

it("returns explicit absence and rejects malformed stored catalog evidence", async () => {
  const receipt = { inputSha256: "a".repeat(64), result: workspaceResult,
    threadScope: null, editorSessionScope: null, runScope: null };
  mocks.find.mockResolvedValueOnce(null);
  const absent = await read("story-workspace-catalog.workspace");
  expect(absent.status).toBe(200);
  expect((await absent.json()).data).toEqual({ status: "absent",
    operation: "story-workspace-catalog.workspace", request_id: requestId });
  for (const candidate of [
    { ...receipt, inputSha256: "invalid" },
    { ...receipt, threadScope: "thread-1" },
    { ...receipt, editorSessionScope: "editor-1" },
    { ...receipt, runScope: "run-1" },
    { ...receipt, result: characterResult },
  ]) {
    mocks.find.mockResolvedValueOnce(candidate);
    const response = await read("story-workspace-catalog.workspace");
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("STORY_WORKSPACE_CATALOG_DATA_INVALID");
  }
});

it("rejects read receipts, delegation credentials, and caller receipt selectors", async () => {
  expect((await read("story-workspace-catalog.read")).status).toBe(404);
  expect(mocks.transaction).not.toHaveBeenCalled();
  mocks.principal.mockRejectedValueOnce(new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403));
  expect((await read("story-workspace-catalog.patch", "idg_grant")).status).toBe(403);
  for (const suffix of ["&resource_id=character-1", "&operation=story-workspace-catalog.patch"])
    expect((await read("story-workspace-catalog.patch", "oauth", suffix)).status).toBe(404);
});
