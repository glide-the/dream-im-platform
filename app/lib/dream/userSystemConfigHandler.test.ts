// [Input] Configured service, live OAuth and closed user SystemConfig envelopes with captured codec/UOW seams.
// [Output] Exact read/write scopes, null entity actor and same-UOW write receipt/audit execution.
// [Pos] Registered handler gate; no public Route, PostgreSQL, Runtime or user-selected codec.
// [Sync] 2026-09-15: prove get is direct while patch is atomically receipt-wrapped for the OAuth owner.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), run: vi.fn(), receipt: vi.fn(), identity: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./userSystemConfigService", async original => ({ ...await original<typeof import("./userSystemConfigService")>(), runUserSystemConfigOperation: mocks.run }));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  constructor(_tx: unknown, serviceId: string, subject: string) { mocks.identity(serviceId, subject); }
  async execute(operation: string, requestId: string, input: unknown, output: unknown, action: () => Promise<unknown>) {
    mocks.receipt(operation, requestId, input, output); return action();
  }
} }));
import { AuthBoundaryError } from "../auth/config";
import { handleUserSystemConfig } from "./userSystemConfigHandler";
import { identitySchemaRequirement } from "./schemaRequirements";
import { userSystemConfigSchemaRequirements } from "./userSystemConfigService";
const service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" as const };
const codec = vi.fn(async () => ({ config_json: "{}" }));
function request(input: unknown = {}, token = "user") { return new Request("http://localhost/api/internal/dream/v1/operations/user-system-config.get", {
  method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request_id: "original", input }) }); }
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536"); mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx)); mocks.run.mockImplementation(async name => name === "user-system-config.get" ? { config_json: "{}" } : { success: true });
});
afterEach(() => vi.unstubAllEnvs());
it.each([
  ["user-system-config.get", {}, "dream:read", { config_json: "{}" }, false],
  ["user-system-config.patch", { theme: "dark" }, "dream:write", { success: true }, true],
] as const)("executes %s with exact OAuth authority and receipt semantics", async (name, input, scope, output, wrapped) => {
  const response = await handleUserSystemConfig(request(input), name, codec); expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: output, request_id: "original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...userSystemConfigSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "user", service, scope);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(name, input, { principal, threadScope: null, runScope: null, editorSessionScope: null }, tx, codec);
  expect(mocks.receipt).toHaveBeenCalledTimes(wrapped ? 1 : 0);
  if (wrapped) {
    expect(mocks.identity).toHaveBeenCalledExactlyOnceWith("service", "subject");
    expect(mocks.receipt.mock.calls[0].slice(0, 3)).toEqual([name, "original", input]);
  }
});
it("rejects identity, entity, storage, executable and Runtime selectors before UOW", async () => {
  for (const key of ["user_id", "actor_id", "thread_id", "workflow_run_id", "system_config_json", "sql", "table", "codec", "path", "runtime"])
    expect((await handleUserSystemConfig(request({ [key]: "caller" }), "user-system-config.patch", codec)).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
});
it.each(["ACCESS_SCOPE_REQUIRED", "DELEGATION_PURPOSE_DENIED", "DREAM_DATA_SCHEMA_NOT_READY"])("fails closed on %s", async code => {
  if (code === "DREAM_DATA_SCHEMA_NOT_READY") mocks.transaction.mockRejectedValueOnce(new AuthBoundaryError(code));
  else mocks.principal.mockRejectedValueOnce(new AuthBoundaryError(code, 403));
  const token = code === "DELEGATION_PURPOSE_DENIED" ? "idg_entity" : "user";
  expect((await handleUserSystemConfig(request({}, token), "user-system-config.get", codec)).status).toBe(code === "DREAM_DATA_SCHEMA_NOT_READY" ? 503 : 403);
  expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.receipt).not.toHaveBeenCalled();
});
it("rejects an unrelated command before parsing or acquiring UOW", async () => {
  expect((await handleUserSystemConfig(request(), "user-system-config.replace", codec)).status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled();
});
