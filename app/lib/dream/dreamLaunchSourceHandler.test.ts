// [Input] Closed source ensure/replay envelopes with fixed service/OAuth/capability/domain collaborators.
// [Output] Live owner composition and selector/entity/scope/capability failures before persistence access.
// [Pos] Provider-free unregistered ingress gate; public source registration/SQL remains separate.
// [Sync] 2026-09-16: cover Registry133 read routing and separate read/write scopes.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), ensure: vi.fn(), lookup: vi.fn() }));
vi.mock("../auth/serviceIdentity", () => ({ requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./dreamLaunchSourceService", async original => ({ ...await original<typeof import("./dreamLaunchSourceService")>(),
  ensureDreamLaunchSource: mocks.ensure, lookupDreamLaunchReplay: mocks.lookup }));
import { handleDreamLaunchSource } from "./dreamLaunchSourceHandler";
import { dreamLaunchSourceSchemaRequirements } from "./dreamLaunchSourceService";
import { AuthBoundaryError } from "../auth/config";
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const }, service = { id: "service" };
const input = { workspace_id: "workspace", deck_id: "deck", agent_id: null, goal: "目标😀", idempotency_key: "source:one" };
function request(raw: unknown = input, token = "original-token") { return new Request("http://localhost/api/internal/dream/v1/operations/dream-launch-source.ensure", { method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ request_id: "original", input: raw }) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "10000"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" })); mocks.ensure.mockResolvedValue({ ensured: true });
  mocks.lookup.mockResolvedValue({ replay: null });
});
it("routes replay lookup through the read principal and omits receipt/write parameters", async () => {
  const response = await handleDreamLaunchSource(request(), "dream-launch-replay.lookup"); expect(response.status).toBe(200);
  expect(mocks.principal).toHaveBeenCalledWith({ marker: "tx" }, "original-token", service, "dream:read");
  expect(mocks.lookup).toHaveBeenCalledWith(input, { principal, threadScope: null, runScope: null }, { marker: "tx" });
  expect(mocks.ensure).not.toHaveBeenCalled();
});
afterEach(() => vi.unstubAllEnvs());
it("composes live OAuth owner, closed source and exact caps in one persistence UOW", async () => {
  const response = await handleDreamLaunchSource(request(), "dream-launch-source.ensure"); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.transaction.mock.calls[0][0]).toEqual(dreamLaunchSourceSchemaRequirements);
  expect(mocks.principal).toHaveBeenCalledWith({ marker: "tx" }, "original-token", service, "dream:write");
  expect(mocks.ensure).toHaveBeenCalledWith(input, { principal, threadScope: null, runScope: null }, "service", "original", { marker: "tx" });
});
it("rejects unknown operation and caller actor/source/metadata/fingerprint before a UOW", async () => {
  expect((await handleDreamLaunchSource(request(), "dream-launch-source.patch")).status).toBe(404);
  for (const field of ["actor_id", "thread_id", "message_id", "metadata", "request_fingerprint", "workflow_run_id"])
    expect((await handleDreamLaunchSource(request({ ...input, [field]: "caller" }), "dream-launch-source.ensure")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.ensure).not.toHaveBeenCalled();
});
it.each(["DREAM_SCOPE_REQUIRED", "DELEGATION_ACTIVATION_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("fails closed on %s before source persistence", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  expect((await handleDreamLaunchSource(request(input, code === "DELEGATION_ACTIVATION_DENIED" ? "idg_entity" : undefined), "dream-launch-source.ensure")).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403);
  expect(mocks.ensure).not.toHaveBeenCalled();
});
