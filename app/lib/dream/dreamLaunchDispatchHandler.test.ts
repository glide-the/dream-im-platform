// [Input] Closed dispatch envelopes and fixed OAuth/live capability/domain collaborators.
// [Output] Both exact UOW compositions and early selector/scope/entity/capability rejection.
// [Pos] Provider-free unregistered ingress gate; no public route or Runtime is attached.
// [Sync] 2026-09-15: repeat OAuth write identity inside each independent claim/finish UOW.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), execute: vi.fn() }));
vi.mock("../auth/serviceIdentity", () => ({ requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./dreamLaunchDispatchService", async original => ({ ...await original<typeof import("./dreamLaunchDispatchService")>(), executeDreamLaunchDispatch: mocks.execute }));
import { handleDreamLaunchDispatch } from "./dreamLaunchDispatchHandler";
import { dreamLaunchDispatchSchemaRequirements } from "./dreamLaunchDispatchService";
import { AuthBoundaryError } from "../auth/config";
const service = { id: "service" }, principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const };
const lookup = { workspace_id: "workspace", workflow_run_id: `run_${"a".repeat(32)}` };
const inputs = { "dream-launch-dispatch.claim": { ...lookup, instruction_text: "目标😀" },
  "dream-launch-dispatch.finish": { ...lookup, claim_id: `dlc_${"b".repeat(32)}`, accepted: false } };
function request(input: unknown) { return new Request("http://localhost/api/internal/dream/v1/operations/dream-launch-dispatch.claim", { method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer original" }, body: JSON.stringify({ request_id: "original", input }) }); }
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "10000"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" })); mocks.execute.mockResolvedValue({ accepted: true }); });
afterEach(() => vi.unstubAllEnvs());
it.each(Object.entries(inputs))("composes %s live identity/capabilities and one closed metadata UOW", async (operation, input) => {
  const response = await handleDreamLaunchDispatch(request(input), operation); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.transaction.mock.calls[0][0]).toEqual(dreamLaunchDispatchSchemaRequirements);
  expect(mocks.principal).toHaveBeenCalledWith({ marker: "tx" }, "original", service, "dream:write");
  expect(mocks.execute).toHaveBeenCalledWith(operation, input, { principal, threadScope: null, runScope: null }, "service", "original", { marker: "tx" });
});
it("rejects unknown operation or actor/context/parts/metadata/status/source patch before any UOW", async () => {
  expect((await handleDreamLaunchDispatch(request(inputs["dream-launch-dispatch.claim"]), "dream-launch-dispatch.patch")).status).toBe(404);
  for (const field of ["actor_id", "context", "parts", "metadata", "dispatch_status", "thread_id", "message_id"])
    expect((await handleDreamLaunchDispatch(request({ ...inputs["dream-launch-dispatch.claim"], [field]: "caller" }), "dream-launch-dispatch.claim")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.execute).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_ACTIVATION_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("fails closed on %s before claim or finish", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  expect((await handleDreamLaunchDispatch(request(inputs["dream-launch-dispatch.claim"]), "dream-launch-dispatch.claim")).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403);
  expect(mocks.execute).not.toHaveBeenCalled();
});
