// [Input] Registry106 Handler with captured actor, UOW and typed service seams.
// [Output] OAuth/Thread grant binding, body limit and no-receipt read evidence.
// [Pos] Provider-free workspace plugin HTTP boundary test.
// [Sync] 2026-09-15: prove exact Thread scope enters one read-only capability-checked UOW.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), actor: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(),
  requireDreamService: mocks.service,
}));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./deckWorkspacePluginsService", async original => ({
  ...await original<typeof import("./deckWorkspacePluginsService")>(),
  runDeckWorkspacePluginsOperation: mocks.run,
}));

import { handleDeckWorkspacePlugins } from "./deckWorkspacePluginsHandler";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { deckWorkspacePluginsSchemaRequirements } from "./deckWorkspacePluginsService";

const actor = { principal: { subject: "subject", canonical_user_id: "42", client_id: "dream", scopes: ["dream:read"], status: "active" }, threadScope: null };
const input = { thread_id: "thread-1", profile: "standard" };
const output = { thread_id: "thread-1", deck_id: null, refs: [], story_workspace_adapter: null };
function request(rawInput: unknown, token = "oauth") {
  return new Request("http://localhost/api/internal/dream/v1/operations/deck-workspace-plugins.resolve", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "workspace-plugins-original", input: rawInput }),
  });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "service" });
  mocks.actor.mockResolvedValue(actor);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
  mocks.run.mockResolvedValue(output);
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["oauth", [identitySchemaRequirement, ...deckWorkspacePluginsSchemaRequirements]],
  ["idg_grant", [identitySchemaRequirement, ...deckWorkspacePluginsSchemaRequirements, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]],
])("binds %s to the input Thread in one read UOW", async (token, requirements) => {
  const response = await handleDeckWorkspacePlugins(request(input, token), "deck-workspace-plugins.resolve");
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: output, request_id: "workspace-plugins-original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual(requirements);
  expect(mocks.actor).toHaveBeenCalledWith(expect.anything(), expect.any(Headers), expect.anything(), "dream:read", "thread-1");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("deck-workspace-plugins.resolve", input, actor, { marker: "tx" });
});

it("rejects actor, package and physical selectors before UOW", async () => {
  for (const key of ["actor_id", "user_id", "deck_id", "package_spec", "path", "sql", "table", "column"])
    expect((await handleDeckWorkspacePlugins(request({ ...input, [key]: "caller" }), "deck-workspace-plugins.resolve")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});

it("enforces body capacity before UOW", async () => {
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "8");
  const response = await handleDeckWorkspacePlugins(request(input), "deck-workspace-plugins.resolve");
  expect(response.status).toBe(413); expect(mocks.transaction).not.toHaveBeenCalled();
});
