// [Input] Candidate OAuth/background requests with fixed service, principal and transaction collaborators.
// [Output] Strict pre-UOW parsing and credential-separated Reflections dispatch evidence.
// [Pos] Provider-free ingress gate; shared operation registry and public Route remain unchanged.
// [Sync] 2026-09-17: cover dual-bearer OAuth, client_credentials worker and user-credential denial.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: vi.fn(),
  principal: vi.fn(),
  transaction: vi.fn(),
  user: vi.fn(),
  background: vi.fn(),
}));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(),
  requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./reflectionTaskService", async original => ({
  ...await original<typeof import("./reflectionTaskService")>(),
  runReflectionTaskUserOperation: mocks.user,
  runReflectionTaskBackgroundOperation: mocks.background,
}));

import { handleReflectionTaskOperation } from "./reflectionTaskHandler";
import { reflectionTaskSchemaRequirements } from "./reflectionTaskService";
import { identitySchemaRequirement } from "./schemaRequirements";

const service = { id: "dream-service", backgroundScopes: ["reflections:execute"] };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" };
const tx = { marker: "tx" };
function request(input: unknown, authorization?: string) {
  return new Request("http://localhost/api/internal/dream/v1/operations/reflection", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: authorization ?? "Bearer service-token",
      ...(authorization ? { "x-ink-dream-service-authorization": "Bearer service-token" } : {}) },
    body: JSON.stringify({ request_id: "original", input }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue(service);
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.user.mockResolvedValue({ reports: [] });
  mocks.background.mockResolvedValue({ task: { task_id: "task" } });
});
afterEach(() => vi.unstubAllEnvs());

it("dispatches OAuth report history with the exact scope, principal and schema requirements", async () => {
  const response = await handleReflectionTaskOperation(request({}, "Bearer user-token"), "analysis-report.list");
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...reflectionTaskSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "user-token", service, "dream:read");
  expect(mocks.user).toHaveBeenCalledExactlyOnceWith("analysis-report.list", { limit: 10 }, { principal, threadScope: null, editorSessionScope: null, runScope: null }, tx, service.id, "original");
  expect(mocks.background).not.toHaveBeenCalled();
});

it("dispatches a worker operation with only the service bearer", async () => {
  const input = { task_id: "11111111-1111-4111-8111-111111111111" };
  const response = await handleReflectionTaskOperation(request(input), "reflection-task.worker-load");
  expect(response.status).toBe(200);
  expect(mocks.background).toHaveBeenCalledExactlyOnceWith("reflection-task.worker-load", input, service, tx, "original");
  expect(mocks.principal).not.toHaveBeenCalled();
  expect(mocks.user).not.toHaveBeenCalled();
});

it("rejects strict-input violations and unknown operations before a transaction", async () => {
  expect((await handleReflectionTaskOperation(request({ limit: 10, sql: "caller" }, "Bearer user-token"), "analysis-report.list")).status).toBe(400);
  expect((await handleReflectionTaskOperation(request({}, "Bearer user-token"), "reflection-task.patch")).status).toBe(404);
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.user).not.toHaveBeenCalled();
});

it("rejects browser credentials on the background path before domain execution", async () => {
  const response = await handleReflectionTaskOperation(request({ task_id: "11111111-1111-4111-8111-111111111111" }, "Bearer browser-token"), "reflection-task.worker-load");
  expect(response.status).toBe(400);
  expect((await response.json()).error.code).toBe("REFLECTION_BROWSER_CREDENTIAL_FORBIDDEN");
  expect(mocks.background).not.toHaveBeenCalled();
  expect(mocks.principal).not.toHaveBeenCalled();
});
