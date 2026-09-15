// [Input] Registry109 original request ID plus current OAuth or exact Thread delegation.
// [Output] Committed/absent Story output evidence with strict stored entity bindings.
// [Pos] Provider-free unknown-COMMIT recovery ingress test; it never reissues the write.
// [Sync] 2026-09-15: validate Thread/result agreement and reject Run or Editor receipt scopes.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: vi.fn(),
  actor: vi.fn(),
  transaction: vi.fn(),
  find: vi.fn(),
}));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(),
  requireDreamService: mocks.service,
}));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./receipts", () => ({ ReceiptRepository: class { find = mocks.find; } }));

import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import {
  identitySchemaRequirement,
  runtimeDelegationSchemaRequirement,
  runtimePurposeSchemaRequirement,
} from "./schemaRequirements";
import { storyWorkspaceOutputSchemaRequirements } from "./storyWorkspaceOutputService";

const name = "story-workspace-output.store";
const requestId = "story-output-original";
const result = {
  story_id: "story-1",
  review_status: "pending",
  character_ids: ["character-1"],
  scene_ids: ["scene-1"],
  chat_thread_id: "thread-1",
  deck_id: "deck-1",
  deck_name: "Deck",
  deck_name_zh: null,
  deck_name_en: null,
};
const principal = {
  subject: "subject",
  canonical_user_id: "42",
  client_id: "dream",
  scopes: ["dream:write"],
  status: "active" as const,
};
const receipt = {
  inputSha256: "a".repeat(64),
  result,
  threadScope: "thread-1",
  editorSessionScope: null,
  runScope: null,
};

function read(token = "oauth", query = `operation=${name}`) {
  return GET(new Request(`http://localhost/api/internal/dream/v1/receipts/${requestId}?${query}`, {
    headers: { authorization: `Bearer ${token}` },
  }), { params: Promise.resolve({ requestId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.service.mockReturnValue({ id: "dream-service" });
  mocks.actor.mockResolvedValue({ principal, threadScope: null, runScope: null, editorSessionScope: null });
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
  mocks.find.mockResolvedValue(receipt);
});

it.each([
  ["oauth", [identitySchemaRequirement, ...storyWorkspaceOutputSchemaRequirements]],
  ["idg_grant", [identitySchemaRequirement, ...storyWorkspaceOutputSchemaRequirements,
    runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]],
] as const)("recovers the original committed DTO for %s authority", async (token, requirements) => {
  if (token.startsWith("idg_")) mocks.actor.mockResolvedValue({ principal, threadScope: "thread-1", runScope: null, editorSessionScope: null });
  const response = await read(token);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "committed", operation: name, request_id: requestId, result }, request_id: requestId });
  expect(mocks.transaction.mock.calls[0][0]).toEqual(requirements);
  expect(mocks.actor).toHaveBeenCalledWith({ marker: "tx" }, expect.any(Headers), { id: "dream-service" }, "dream:write", undefined, undefined, name);
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith(name, requestId);
});

it("returns explicit absence without executing the original write", async () => {
  mocks.find.mockResolvedValue(null);
  const response = await read();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { status: "absent", operation: name, request_id: requestId }, request_id: requestId });
  expect(mocks.find).toHaveBeenCalledOnce();
});

it.each([
  ["inputSha256", "not-a-sha"],
  ["threadScope", "thread-2"],
  ["editorSessionScope", "editor-1"],
  ["runScope", "run-1"],
] as const)("rejects a committed receipt with invalid %s", async (field, value) => {
  mocks.find.mockResolvedValue({ ...receipt, [field]: value });
  const response = await read();
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("STORY_WORKSPACE_OUTPUT_DATA_INVALID");
});

it("rejects result and delegated Thread mismatches plus caller selectors", async () => {
  mocks.find.mockResolvedValue({ ...receipt, result: { ...result, chat_thread_id: "thread-2" } });
  expect((await read()).status).toBe(503);
  mocks.actor.mockResolvedValue({ principal, threadScope: "thread-2", runScope: null, editorSessionScope: null });
  mocks.find.mockResolvedValue(receipt);
  expect((await read("idg_grant")).status).toBe(403);
  for (const query of [`operation=${name}&thread_id=thread-1`, `operation=${name}&operation=${name}`]) {
    expect((await read("oauth", query)).status).toBe(404);
  }
});
