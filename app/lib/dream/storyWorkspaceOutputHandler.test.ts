// [Input] Registry109 HTTP envelope, service identity and OAuth or exact Thread delegation.
// [Output] Body limit, capability requirements, actor binding and one output UOW assertion.
// [Pos] Provider-free Story output ingress test.
// [Sync] 2026-09-15: reject caller authority selectors before opening the Admin transaction.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), actor: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./storyWorkspaceOutputService", async original => ({
  ...await original<typeof import("./storyWorkspaceOutputService")>(), runStoryWorkspaceOutputOperation: mocks.run,
}));
import { handleStoryWorkspaceOutput } from "./storyWorkspaceOutputHandler";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceOutputSchemaRequirements } from "./storyWorkspaceOutputService";
const input = { thread_id: "thread-1", story: { title: "标题", description: null, type: "short", content: null,
  characters: [], scenes: [] } };
const output = { story_id: "story-1", review_status: "pending", character_ids: [], scene_ids: [],
  chat_thread_id: "thread-1", deck_id: null, deck_name: null, deck_name_zh: null, deck_name_en: null };
const actor = { principal: { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" }, threadScope: null, runScope: null };
function request(rawInput: unknown, token = "oauth") { return new Request("http://localhost/api/internal/dream/v1/operations/story-workspace-output.store", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({ request_id: "story-output-original", input: rawInput }),
}); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream-service" }); mocks.actor.mockResolvedValue(actor);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" })); mocks.run.mockResolvedValue(output); });
afterEach(() => vi.unstubAllEnvs());
it.each([["oauth", [identitySchemaRequirement, ...storyWorkspaceOutputSchemaRequirements]],
  ["idg_grant", [identitySchemaRequirement, ...storyWorkspaceOutputSchemaRequirements,
    runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]]])("binds %s authority to the exact Thread", async (token, requirements) => {
  const response = await handleStoryWorkspaceOutput(request(input, token), "story-workspace-output.store");
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: output, request_id: "story-output-original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual(requirements);
  expect(mocks.actor).toHaveBeenCalledWith({ marker: "tx" }, expect.any(Headers), { id: "dream-service" }, "dream:write", "thread-1", undefined);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("story-workspace-output.store", input, actor,
    "dream-service", "story-output-original", { marker: "tx" });
});
it("rejects actor, database, path and Workspace selectors before the UOW", async () => {
  for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "path"])
    expect((await handleStoryWorkspaceOutput(request({ ...input, [key]: "caller" }), "story-workspace-output.store")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
