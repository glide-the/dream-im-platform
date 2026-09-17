// [Input] Registry114 HTTP envelopes, configured Dream service, and OAuth access token.
// [Output] Body limit, exact scope, capability requirements, and one-UOW ingress assertions.
// [Pos] Provider-free Story Workspace catalog ingress test.
// [Sync] 2026-09-15: reject delegation and caller authority/persistence selectors at the OAuth boundary.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./storyWorkspaceCatalogService", async original => ({
  ...await original<typeof import("./storyWorkspaceCatalogService")>(), runStoryWorkspaceCatalogOperation: mocks.run,
}));
import { handleStoryWorkspaceCatalog } from "./storyWorkspaceCatalogHandler";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceCatalogSchemaRequirements } from "./storyWorkspaceCatalogService";

const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" };
function request(rawInput: unknown, operation = "story-workspace-catalog.read", token = "oauth") {
  return new Request(`http://localhost/api/internal/dream/v1/operations/${operation}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "catalog-original", input: rawInput }),
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream-service" }); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
  mocks.run.mockResolvedValue({ view: "story_detail", item: { id: "story-1" } });
});
afterEach(() => vi.unstubAllEnvs());

it("derives a read actor from OAuth and opens one capability-gated UOW", async () => {
  const input = { view: "story_detail", resource_id: "story-1" };
  const response = await handleStoryWorkspaceCatalog(request(input), "story-workspace-catalog.read");
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...storyWorkspaceCatalogSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledWith({ marker: "tx" }, "oauth", { id: "dream-service" }, "dream:read");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("story-workspace-catalog.read", input, principal,
    "dream-service", "catalog-original", { marker: "tx" });
});

it("rejects caller authority and persistence selectors before the UOW", async () => {
  const input = { view: "story_detail", resource_id: "story-1" };
  for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "path"])
    expect((await handleStoryWorkspaceCatalog(request({ ...input, [key]: "caller" }),
      "story-workspace-catalog.read")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
