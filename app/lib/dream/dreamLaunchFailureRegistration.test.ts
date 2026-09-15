// [Input] Actual production POST/GET with captured auth/UOW/domain seams and the real fixed server codec.
// [Output] Registered77 default overlay, exact capabilities, original OAuth recovery and strict query/body.
// [Pos] New registration gate; old source/domain tests and public PostgreSQL acceptance remain separate.
// [Sync] 2026-09-15: preserve all released76 behavior and test only the newly wired failure path.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), actor: vi.fn(), oauth: vi.fn(), transaction: vi.fn(), persist: vi.fn(), read: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.oauth }));
vi.mock("./principal", () => ({ requireDataActor: mocks.actor }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./dreamLaunchFailureService", async original => ({ ...await original<typeof import("./dreamLaunchFailureService")>(), persistDreamLaunchFailureEnvelope: mocks.persist }));
vi.mock("./dreamLaunchFailureOriginalReceiptService", () => ({ readOriginalDreamLaunchFailureReceipt: mocks.read }));
import { AuthBoundaryError } from "../auth/config";
import { POST } from "../../api/internal/dream/v1/operations/[operation]/route";
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import type { DreamLaunchFailureOverlay } from "./dreamLaunchFailureService";
const name = "dream-launch-failure.envelope", run = `run_${"a".repeat(32)}`, service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:write"], status: "active" as const }, actor = { principal, threadScope: null, runScope: null };
const input = { workspace_id: "workspace", workflow_run_id: run, error_code: "AGENT_TERMINAL_ERROR" }, output = { updated: true, workflow_run_id: run, thread_id: "thread", message_id: "message", error_code: input.error_code };
function post(value: unknown = input, token = "user") { return new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request_id: "original", input: value }) }); }
function read(query = `operation=${name}`, token = "user") { return GET(new Request(`http://localhost/api/internal/dream/v1/receipts/original?${query}`, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ requestId: "original" }) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000");
  mocks.service.mockReturnValue(service); mocks.actor.mockResolvedValue(actor); mocks.oauth.mockResolvedValue(principal); mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.persist.mockResolvedValue(output); mocks.read.mockResolvedValue({ status: "committed", operation: name, request_id: "original", result: output });
});
afterEach(() => vi.unstubAllEnvs());
it("actual POST supplies the real fixed server codec preserving bigint/float/negative-zero and deleting both claim fields", async () => {
  let encoded: { metadata_json: string } | undefined;
  mocks.persist.mockImplementationOnce(async (_input, _actor, _service, _request, _tx, overlay: DreamLaunchFailureOverlay) => {
    encoded = await overlay('{"integer":9007199254740993,"float":1.0,"negative":-0.0,"dispatchClaimId":"old","dispatchClaimedAt":"old"}', input.error_code); return output;
  });
  const request = post(), response = await POST(request, { params: Promise.resolve({ operation: name }) }); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, dreamUnifiedSchemaRequirement]); expect(mocks.actor).toHaveBeenCalledExactlyOnceWith(tx, request.headers, service, "dream:write", undefined, run);
  expect(mocks.persist.mock.calls[0].slice(0, 5)).toEqual([input, actor, "service", "original", tx]);
  expect(encoded).toEqual({ metadata_json: '{"dispatchErrorCode":"AGENT_TERMINAL_ERROR","dispatchStatus":"failed","float":1.0,"integer":9007199254740993,"negative":-0.0}' });
});
it("original Run persistence POST adds exact immutable delegation/purpose caps without a caller Run override", async () => {
  const request = post(input, "idg_original"); expect((await POST(request, { params: Promise.resolve({ operation: name }) })).status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, dreamUnifiedSchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]);
  expect(mocks.actor.mock.calls[0].slice(3)).toEqual(["dream:write", undefined, run]);
});
it("POST rejects actor/source/status/context/metadata/codec/path selectors before UOW", async () => {
  for (const field of ["actor_id", "source_message_id", "status", "context", "metadata", "codec", "path"])
    expect((await POST(post({ ...input, [field]: "caller" }), { params: Promise.resolve({ operation: name }) })).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.persist).not.toHaveBeenCalled();
});
it("actual original GET validates live OAuth write/exact caps and delegates full original completion", async () => {
  const response = await read(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, dreamUnifiedSchemaRequirement]); expect(mocks.oauth).toHaveBeenCalledExactlyOnceWith(tx, "user", service, "dream:write");
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith(tx, "service", principal, name, "original"); expect(mocks.persist).not.toHaveBeenCalled();
});
it("GET rejects duplicated operation and ordinary source/error/codec/path query selectors", async () => {
  for (const tail of [`operation=${name}`, "source_message_id=caller", "error_code=caller", "codec=caller", "path=caller", "unexpected=caller"])
    expect((await read(`operation=${name}&${tail}`)).status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_ENTITY_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("POST fails closed on %s", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code)); else mocks.actor.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  expect((await POST(post(), { params: Promise.resolve({ operation: name }) })).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403); expect(mocks.persist).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_PURPOSE_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("GET fails closed on %s", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code)); else mocks.oauth.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  expect((await read(undefined, code === "DELEGATION_PURPOSE_DENIED" ? "idg_original" : "user")).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403); expect(mocks.read).not.toHaveBeenCalled();
});
