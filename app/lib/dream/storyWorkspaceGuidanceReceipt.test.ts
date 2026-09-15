// [Input] Registry115 original guidance request ID plus current OAuth actor.
// [Output] Strict committed/absent result bound to stored Run/Thread scopes and dispatch identity.
// [Pos] Provider-free unknown-COMMIT recovery test; it never reissues guidance persistence.
// [Sync] 2026-09-15: validate exact OAuth-only Story guidance receipt recovery.
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
import { storyWorkspaceGuidanceSchemaRequirements } from "./storyWorkspaceGuidanceService";

const runId = `run_${"a".repeat(32)}`;
const threadId = "thread-guidance";
const requestId = "guidance-original";
const metadata = { kind: "story-workspace-guidance", story_workspace_run_id: runId, actor: "42",
  request_id: requestId, idempotency_key: "guide-1", command_kind: "free-text", step_id: null,
  text_summary: "继续", review_action: "guide", command_fingerprint: `sha256:${"b".repeat(64)}` };
const result = { message_id: "guide_guide-1", story_workspace_run_id: runId, review_action: "guide",
  status: "accepted", replayed: false, request_id: requestId,
  dispatch: { thread_id: threadId, message_id: "guide_guide-1",
    parts: [{ type: "text", text: `[story-workspace guidance · run ${runId}] 继续` }], metadata } };
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" as const };

function read(token = "oauth", suffix = "") {
  return GET(new Request(
    `http://localhost/api/internal/dream/v1/receipts/${requestId}?operation=story-workspace-guidance.submit${suffix}`,
    { headers: { authorization: `Bearer ${token}` } },
  ), { params: Promise.resolve({ requestId }) });
}

beforeEach(() => {
  vi.resetAllMocks(); mocks.service.mockReturnValue({ id: "dream-service" }); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
});

it("recovers the exact committed dispatch DTO under OAuth and stored entity scopes", async () => {
  mocks.find.mockResolvedValue({ inputSha256: "a".repeat(64), result,
    threadScope: threadId, editorSessionScope: null, runScope: runId });
  const response = await read();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "committed", operation: "story-workspace-guidance.submit",
    request_id: requestId, result }, request_id: requestId });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...storyWorkspaceGuidanceSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith({ marker: "tx" }, "oauth", { id: "dream-service" }, "dream:write");
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith("story-workspace-guidance.submit", requestId);
});

it("returns explicit absence and rejects malformed or cross-scope stored evidence", async () => {
  mocks.find.mockResolvedValueOnce(null);
  const absent = await read();
  expect(absent.status).toBe(200);
  expect((await absent.json()).data).toEqual({ status: "absent",
    operation: "story-workspace-guidance.submit", request_id: requestId });
  const base = { inputSha256: "a".repeat(64), result,
    threadScope: threadId, editorSessionScope: null, runScope: runId };
  for (const candidate of [
    { ...base, inputSha256: "invalid" },
    { ...base, threadScope: null },
    { ...base, editorSessionScope: "editor-1" },
    { ...base, runScope: `run_${"c".repeat(32)}` },
    { ...base, result: { ...result, dispatch: { ...result.dispatch, thread_id: "other-thread" } } },
    { ...base, result: { ...result, dispatch: { ...result.dispatch,
      metadata: { ...metadata, actor: "43" } } } },
  ]) {
    mocks.find.mockResolvedValueOnce(candidate);
    const response = await read();
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("STORY_WORKSPACE_GUIDANCE_DATA_INVALID");
  }
});

it("rejects delegation credentials and caller receipt selectors", async () => {
  mocks.principal.mockRejectedValueOnce(new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403));
  expect((await read("idg_grant")).status).toBe(403);
  for (const suffix of ["&thread_id=thread-guidance", `&run_id=${runId}`])
    expect((await read("oauth", suffix)).status).toBe(404);
});
