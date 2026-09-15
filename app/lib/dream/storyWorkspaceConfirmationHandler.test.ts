// [Input] Registry120 OAuth/background envelopes and mocked service/principal/Admin transaction.
// [Output] Strict audience separation, scope binding and single-UOW dispatch assertions.
// [Pos] Provider-free HTTP ingress test for Story Workspace confirmation operations.
// [Sync] 2026-09-16: verify bearer and service-only paths cannot be interchanged.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), oauth: vi.fn(), background: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./storyWorkspaceConfirmationService", async original => ({
  ...await original<typeof import("./storyWorkspaceConfirmationService")>(),
  runStoryWorkspaceConfirmationOAuthOperation: mocks.oauth,
  runStoryWorkspaceConfirmationBackgroundOperation: mocks.background,
}));
import { handleStoryWorkspaceConfirmation } from "./storyWorkspaceConfirmationHandler";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceConfirmationSchemaRequirements } from "./storyWorkspaceConfirmationService";

const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream", scopes: ["dream:write"], status: "active" as const };
const service = { id: "dream-service", backgroundScopes: ["story-confirmation:dispatch"] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue(service);
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
  mocks.oauth.mockResolvedValue({ status: "accepted" });
  mocks.background.mockResolvedValue({ dispatch: null });
});
afterEach(() => vi.unstubAllEnvs());
function request(name: string, input: unknown, bearer?: string) {
  return new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify({ request_id: "request-1", input }),
  });
}

it("binds OAuth submit to the canonical principal", async () => {
  const name = "story-workspace-confirmation.submit";
  const input = { command_json: "{}" };
  const response = await handleStoryWorkspaceConfirmation(request(name, input, "oauth"), name);
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...storyWorkspaceConfirmationSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith({ marker: "tx" }, "oauth", service, "dream:write");
  expect(mocks.oauth).toHaveBeenCalledExactlyOnceWith(name, input, principal, service.id, "request-1", { marker: "tx" });
  expect(mocks.background).not.toHaveBeenCalled();
});

it("runs claim only with configured service identity and rejects a browser bearer", async () => {
  const name = "story-workspace-confirmation.claim";
  const input = { message_id: null, claim_id: "claim-1" };
  expect((await handleStoryWorkspaceConfirmation(request(name, input), name)).status).toBe(200);
  expect(mocks.background).toHaveBeenCalledExactlyOnceWith(name, input, service, { marker: "tx" });
  expect(mocks.principal).not.toHaveBeenCalled();
  expect((await handleStoryWorkspaceConfirmation(request(name, input, "oauth"), name)).status).toBe(400);
});

it("rejects extra actor/SQL selectors before either service", async () => {
  const name = "story-workspace-confirmation.claim";
  for (const input of [
    { message_id: null, claim_id: "claim-1", actor_id: "42" },
    { message_id: null, claim_id: "claim-1", table: "chat_message" },
  ]) expect((await handleStoryWorkspaceConfirmation(request(name, input), name)).status).toBe(400);
  expect(mocks.oauth).not.toHaveBeenCalled();
  expect(mocks.background).not.toHaveBeenCalled();
});
