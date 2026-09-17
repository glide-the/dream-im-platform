// [Input] Registry115 OAuth request envelope and mocked Admin transaction/principal/service.
// [Output] Strict body, capability and single-dispatch ingress assertions.
// [Pos] Provider-free HTTP handler contract for Story Workspace guidance.
// [Sync] 2026-09-15: verify OAuth-only guidance dispatch into the DTO/ORM service.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./storyWorkspaceGuidanceService", async original => ({
  ...await original<typeof import("./storyWorkspaceGuidanceService")>(), runStoryWorkspaceGuidanceOperation: mocks.run,
}));
import { handleStoryWorkspaceGuidance } from "./storyWorkspaceGuidanceHandler";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceGuidanceSchemaRequirements } from "./storyWorkspaceGuidanceService";

const runId = `run_${"a".repeat(32)}`;
const input = { workflow_run_id: runId, kind: "free-text", text: "继续", step_id: null, idempotency_key: "guide-1" };
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" as const };

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream-service" }); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
  mocks.run.mockResolvedValue({ status: "accepted" });
});
afterEach(() => vi.unstubAllEnvs());

function request(body: unknown, token = "oauth") {
  return new Request("http://localhost/api/internal/dream/v1/operations/story-workspace-guidance.submit", {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

it("binds the exact OAuth actor and Registry115 schema in one transaction", async () => {
  const response = await handleStoryWorkspaceGuidance(request({ request_id: "request-1", input }), "story-workspace-guidance.submit");
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: { status: "accepted" }, request_id: "request-1" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...storyWorkspaceGuidanceSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith({ marker: "tx" }, "oauth", { id: "dream-service" }, "dream:write");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
    "story-workspace-guidance.submit", input, principal, "dream-service", "request-1", { marker: "tx" },
  );
});

it("rejects extra actor/transaction selectors and unregistered operations before the service", async () => {
  for (const invalid of [
    { request_id: "request-1", input: { ...input, actor: "42" } },
    { request_id: "request-1", input, transaction: "caller" },
  ]) expect((await handleStoryWorkspaceGuidance(request(invalid), "story-workspace-guidance.submit")).status).toBe(400);
  expect((await handleStoryWorkspaceGuidance(request({ request_id: "request-1", input }), "sql.execute")).status).toBe(404);
  expect(mocks.run).not.toHaveBeenCalled();
});
