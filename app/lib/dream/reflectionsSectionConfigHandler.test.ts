// [Input] Configured service/live OAuth and exact named section-config UOW with captured domain collaborator.
// [Output] Strict read/write scope, exact capabilities and body/permission/schema/name fail-closed evidence.
// [Pos] Domain ingress tests; public Route registration has a separate deterministic gate.
// [Sync] 2026-09-15: retain OAuth ownership without entity, actor, path or Runtime selectors.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./reflectionsSectionConfigService", async original => ({ ...await original<typeof import("./reflectionsSectionConfigService")>(), runReflectionsSectionConfigOperation: mocks.run }));
import { AuthBoundaryError } from "../auth/config";
import { handleReflectionsSectionConfig } from "./reflectionsSectionConfigHandler";
import { reflectionsSectionConfigSchemaRequirements } from "./reflectionsSectionConfigService";
import { identitySchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
const service = { id: "service" }, tx = { marker: "tx" }, principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" };
function request(input: unknown = { section: "echoes" }, token = "user") { return new Request("http://localhost/api/internal/dream/v1/operations/reflections-section-config.get", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request_id: "original", input }) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx)); mocks.run.mockResolvedValue({ prompt_files_json: null });
});
afterEach(() => vi.unstubAllEnvs());
it.each(["get", "save", "delete"])("delegates %s with live OAuth/exact capabilities and null entity actor", async action => {
  const name = `reflections-section-config.${action}`, input = action === "save" ? { section: "echoes", prompt_files_json: '{"WORKFLOW.md":"正文"}' } : { section: "echoes" };
  const response = await handleReflectionsSectionConfig(request(input), name); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(reflectionsSectionConfigSchemaRequirements).toEqual([identitySchemaRequirement, dreamUnifiedSchemaRequirement]); expect(mocks.transaction.mock.calls[0][0]).toEqual(reflectionsSectionConfigSchemaRequirements);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "user", service, action === "get" ? "dream:read" : "dream:write");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(name, input, { principal, threadScope: null }, tx, "service", "original");
});
it("rejects invalid section, arbitrary prompt files and actor/SQL/path/default selectors before UOW", async () => {
  for (const input of [{ section: "other" }, { section: "echoes", actor_id: "caller" }, { section: "echoes", path: "/caller" }, { section: "echoes", sql: "caller" }, { section: "echoes", default: true }])
    expect((await handleReflectionsSectionConfig(request(input), "reflections-section-config.get")).status).toBe(400);
  expect((await handleReflectionsSectionConfig(request({ section: "echoes", prompt_files_json: '{"OTHER.md":"正文"}' }), "reflections-section-config.save")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_PURPOSE_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("fails closed on %s without domain execution", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  expect((await handleReflectionsSectionConfig(request(undefined, code === "DELEGATION_PURPOSE_DENIED" ? "idg_entity" : "user"), "reflections-section-config.get")).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403);
  expect(mocks.run).not.toHaveBeenCalled();
});
it("rejects a different command before acquiring UOW", async () => {
  expect((await handleReflectionsSectionConfig(request(), "reflections-section-config.patch")).status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled();
});
