// [Input] Registry111 HTTP envelope, configured service and OAuth access token.
// [Output] Body limit, capability requirements, OAuth-only principal and one UOW assertion.
// [Pos] Provider-free Story Workspace review ingress test.
// [Sync] 2026-09-15: reject delegation and caller authority selectors at the OAuth boundary.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./storyWorkspaceReviewService", async original => ({
  ...await original<typeof import("./storyWorkspaceReviewService")>(), runStoryWorkspaceReviewOperation: mocks.run,
}));
import { handleStoryWorkspaceReview } from "./storyWorkspaceReviewHandler";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceReviewSchemaRequirements } from "./storyWorkspaceReviewService";

const input = { resource_type: "story", resource_id: "story-1", action: "confirm", review_notes: null } as const;
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" };
function request(rawInput: unknown, token = "oauth") {
  return new Request("http://localhost/api/internal/dream/v1/operations/story-workspace-review.transition", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "review-original", input: rawInput }),
  });
}
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream-service" }); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
  mocks.run.mockResolvedValue({ resource_type: "story", item: { id: "story-1" } });
});
afterEach(() => vi.unstubAllEnvs());

it("derives the actor from an OAuth token and opens one capability-gated UOW", async () => {
  const response = await handleStoryWorkspaceReview(request(input), "story-workspace-review.transition");
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...storyWorkspaceReviewSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledWith({ marker: "tx" }, "oauth", { id: "dream-service" }, "dream:write");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("story-workspace-review.transition", input, principal,
    "dream-service", "review-original", { marker: "tx" });
});

it("rejects caller-controlled authority and persistence selectors before the UOW", async () => {
  for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "path"])
    expect((await handleStoryWorkspaceReview(request({ ...input, [key]: "caller" }),
      "story-workspace-review.transition")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
