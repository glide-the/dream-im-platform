// [Input] Fixed configured service/UOW/live actor and a mandatory server-only failure overlay.
// [Output] Closed ingress with original Run grant, exact capability and permission failures.
// [Pos] Unregistered provider-free Handler gate; no shared Route/Registry or codec-map wiring.
// [Sync] 2026-09-15: verify terminal persistence receives no caller-controlled source/runtime fields.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), transaction: vi.fn(), actor: vi.fn(), persist: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./dreamLaunchFailureService", async original => ({ ...await original<typeof import("./dreamLaunchFailureService")>(), persistDreamLaunchFailureEnvelope: mocks.persist }));
import { AuthBoundaryError } from "../auth/config";
import { handleDreamLaunchFailure } from "./dreamLaunchFailureHandler";
import { dreamLaunchFailureEnvelopeOutputDto } from "./dreamLaunchFailureDto";
import { dreamLaunchFailureSchemaRequirements } from "./dreamLaunchFailureService";
import { runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
const input = { workspace_id: "workspace", workflow_run_id: `run_${"a".repeat(32)}`, error_code: " " };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const service = { id: "service" }, tx = { marker: "tx" }, actor = { principal, threadScope: null, runScope: null }, overlay = vi.fn(async () => ({ metadata_json: "fixed" }));
function request(value: unknown = input, token = "user") { return new Request("http://localhost/api/internal/dream/v1/operations/dream-launch-failure.envelope", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request_id: "original", input: value }) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockReturnValue(service); mocks.actor.mockResolvedValue(actor);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx)); mocks.persist.mockResolvedValue(dreamLaunchFailureEnvelopeOutputDto.parse({ updated: true,
    workflow_run_id: input.workflow_run_id, error_code: input.error_code, thread_id: "thread", message_id: "message" }));
});
afterEach(() => vi.unstubAllEnvs());
it("passes OAuth write actor and the exact mandatory server collaborator to one independent UOW", async () => {
  const req = request(), response = await handleDreamLaunchFailure(req, "dream-launch-failure.envelope", overlay);
  expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.transaction.mock.calls[0][0]).toEqual(dreamLaunchFailureSchemaRequirements);
  expect(mocks.actor).toHaveBeenCalledExactlyOnceWith(tx, req.headers, service, "dream:write", undefined, input.workflow_run_id);
  expect(mocks.persist).toHaveBeenCalledExactlyOnceWith(input, actor, "service", "original", tx, overlay); expect(overlay).not.toHaveBeenCalled();
});
it("requires both immutable grant capabilities and resolves the original Run for terminal persistence", async () => {
  const bounded = { ...actor, threadScope: "thread", runScope: input.workflow_run_id }; mocks.actor.mockResolvedValueOnce(bounded);
  const req = request(input, "idg_original"), response = await handleDreamLaunchFailure(req, "dream-launch-failure.envelope", overlay);
  expect(response.status).toBe(200); expect(mocks.transaction.mock.calls[0][0]).toEqual([...dreamLaunchFailureSchemaRequirements, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]);
  expect(mocks.actor).toHaveBeenCalledExactlyOnceWith(tx, req.headers, service, "dream:write", undefined, input.workflow_run_id);
  expect(mocks.persist.mock.calls[0][1]).toEqual(bounded);
});
it("rejects caller source/actor/status/context/metadata/path selectors before the domain transaction", async () => {
  for (const field of ["thread_id", "message_id", "actor_id", "status", "context", "metadata", "codec", "path"])
    expect((await handleDreamLaunchFailure(request({ ...input, [field]: "caller" }), "dream-launch-failure.envelope", overlay)).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_ENTITY_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("fails closed on %s before failure persistence", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.actor.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  expect((await handleDreamLaunchFailure(request(input, "idg_original"), "dream-launch-failure.envelope", overlay)).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403);
  expect(mocks.persist).not.toHaveBeenCalled(); expect(overlay).not.toHaveBeenCalled();
});
it("rejects an unrelated operation without acquiring business authority", async () => {
  expect((await handleDreamLaunchFailure(request(), "dream-launch-failure.patch", overlay)).status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled();
});
