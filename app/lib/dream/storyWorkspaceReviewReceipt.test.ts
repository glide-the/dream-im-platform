// [Input] Registry111 original request ID plus current OAuth actor.
// [Output] Strict committed/absent review evidence with null entity scopes.
// [Pos] Provider-free unknown-COMMIT recovery ingress test; it never reissues the write.
// [Sync] 2026-09-15: validate OAuth-only Story Workspace review receipts.
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
import { storyWorkspaceReviewSchemaRequirements } from "./storyWorkspaceReviewService";

const name = "story-workspace-review.transition";
const requestId = "review-original";
const time = "2026-09-15T01:02:03.000Z";
const item = { id: "scene-1", identifier: "scene-one", name: "场景", description: null,
  story_id: "story-1", character_count: 1, order_index: 0, review_status: "confirmed",
  review_notes: null, status: "active", created_at: time, updated_at: time, confirmed_at: time,
  archived_at: null };
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" as const };
const receipt = { inputSha256: "a".repeat(64), result: { resource_type: "scene", item },
  threadScope: null, editorSessionScope: null, runScope: null };
function read(query = `operation=${name}`, token = "oauth") {
  return GET(new Request(`http://localhost/api/internal/dream/v1/receipts/${requestId}?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  }), { params: Promise.resolve({ requestId }) });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.service.mockReturnValue({ id: "dream-service" });
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
  mocks.find.mockResolvedValue(receipt);
});

it("recovers the exact committed review DTO under OAuth", async () => {
  const response = await read();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "committed", operation: name,
    request_id: requestId, result: receipt.result }, request_id: requestId });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...storyWorkspaceReviewSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledWith({ marker: "tx" }, "oauth", { id: "dream-service" }, "dream:write");
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith(name, requestId);
});

it("returns explicit absence and rejects scoped or malformed stored evidence", async () => {
  mocks.find.mockResolvedValueOnce(null);
  expect((await read()).status).toBe(200);
  for (const candidate of [
    { ...receipt, inputSha256: "invalid" },
    { ...receipt, threadScope: "thread-1" },
    { ...receipt, editorSessionScope: "editor-1" },
    { ...receipt, runScope: "run-1" },
    { ...receipt, result: { resource_type: "story", item } },
  ]) {
    mocks.find.mockResolvedValueOnce(candidate);
    const response = await read();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("STORY_WORKSPACE_REVIEW_DATA_INVALID");
  }
});

it("rejects delegation credentials and caller receipt selectors", async () => {
  mocks.principal.mockRejectedValueOnce(new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403));
  const delegated = await read(`operation=${name}`, "idg_grant");
  expect(delegated.status).toBe(403);
  for (const query of [`operation=${name}&resource_id=scene-1`, `operation=${name}&operation=${name}`])
    expect((await read(query)).status).toBe(404);
});
