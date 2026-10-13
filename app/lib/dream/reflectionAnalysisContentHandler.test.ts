// [Input] Real content ingress with synthetic service/principal/UOW and strict public DTOs.
// [Output] Credential separation, capability gate and pre-transaction rejection evidence.
// [Pos] Provider-free handler contract; no database, provider or business mutation.
// [Sync] 2026-10-13: verify appended content dispatch through the production handler.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), user: vi.fn(), worker: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./reflectionAnalysisContentService", async original => ({ ...await original<typeof import("./reflectionAnalysisContentService")>(), runReflectionAnalysisUserOperation: mocks.user, runReflectionAnalysisBackgroundOperation: mocks.worker }));
import { handleReflectionAnalysisOperation } from "./reflectionAnalysisContentHandler";
import { reflectionAnalysisSchemaRequirement } from "./reflectionAnalysisContentService";
const service = { id: "fixture-service", backgroundScopes: ["reflections:execute"] };
const principal = { subject: "fixture-subject", canonical_user_id: "7", client_id: "fixture-browser", scopes: ["dream:read", "dream:write"], status: "active" };
const task_id = "11111111-1111-4111-8111-111111111111";
function request(input: unknown, user = false) { return new Request("https://fixture.test/api/internal/dream/v1/operations/content", {
  method: "POST", headers: { "content-type": "application/json", authorization: user ? "Bearer fixture-user" : "Bearer fixture-service",
    ...(user ? { "x-ink-dream-service-authorization": "Bearer fixture-service" } : {}) },
  body: JSON.stringify({ request_id: "fixture-request", input }) }); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockReturnValue(service);
  mocks.principal.mockResolvedValue(principal); mocks.transaction.mockImplementation(async (_requirements, run) => run({ fixture: true }));
  mocks.worker.mockResolvedValue({ analysis_content: { diary_session_ids: null, notion: null, agent: null } });
  mocks.user.mockResolvedValue({ analysis_content: null }); });
afterEach(() => vi.unstubAllEnvs());
it("binds the owner summary to live OAuth and the published forward capability", async () => {
  const response = await handleReflectionAnalysisOperation(request({ task_id }, true), "reflection-task.analysis-content");
  expect(response.status).toBe(200);
  expect(mocks.principal.mock.calls[0][3]).toBe("dream:read");
  expect(mocks.transaction.mock.calls[0][0]).toContainEqual(reflectionAnalysisSchemaRequirement);
  expect(mocks.user.mock.calls[0][0]).toBe("reflection-task.analysis-content");
});
it("keeps frozen bodies service-only and rejects a delegated user bearer", async () => {
  expect((await handleReflectionAnalysisOperation(request({ task_id }), "reflection-task.analysis-content-load")).status).toBe(200);
  expect(mocks.principal).not.toHaveBeenCalled();
  expect((await handleReflectionAnalysisOperation(request({ task_id }, true), "reflection-task.analysis-content-load")).status).toBe(400);
  expect(mocks.worker).toHaveBeenCalledTimes(1);
});
it("rejects input ownership/path/prompt overrides before entering the transaction", async () => {
  const input = { sections: ["echoes"], input_snapshot: { session_ids: [], start_date: null, end_date: null, language: "en", language_label: "English" },
    analysis_content: { diary_session_ids: null, notion: null, agent: { deck_id: "deck", agent_id: "agent", system_prompt: "override" } } };
  expect((await handleReflectionAnalysisOperation(request(input, true), "reflection-task.create-with-content")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
