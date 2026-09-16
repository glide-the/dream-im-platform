// [Input] Registry175-184 HTTP envelopes, mocked service identity/OAuth principal and Admin UOW seams.
// [Output] OAuth/background scope, bearer separation, schema-gate and original-receipt assertions.
// [Pos] Provider-free shared Claude Plugin ingress test.
// [Sync] 2026-09-17: verify client_credentials background and dual-bearer user calls.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), transaction: vi.fn(), principal: vi.fn(), run: vi.fn(), receipt: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("./database", async original => ({ ...await original<typeof import("./database")>(), withDataTransaction: mocks.transaction }));
vi.mock("../auth/serviceAccessToken", async original => ({ ...await original<typeof import("../auth/serviceAccessToken")>(), principalForServiceToken: mocks.principal }));
vi.mock("./claudePluginDataService", async original => ({ ...await original<typeof import("./claudePluginDataService")>(),
  runClaudePluginOperation: mocks.run, runClaudePluginBackgroundOperation: mocks.run }));
vi.mock("./receipts", () => ({ ReceiptRepository: class { constructor(..._args: unknown[]) {} execute = mocks.receipt; } }));

import { handleClaudePluginOperation } from "./claudePluginDataHandler";
import { claudePluginDataSchemaRequirements } from "./claudePluginDataService";
import { identitySchemaRequirement } from "./schemaRequirements";

const tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" as const };
function request(operation: string, input: unknown) {
  return new Request(`http://admin.local/api/internal/dream/v1/operations/${operation}`, { method: "POST", headers: {
    authorization: "Bearer oauth-token", "x-ink-dream-service-authorization": "Bearer service-token",
    "content-type": "application/json", origin: "http://dream.local",
  }, body: JSON.stringify({ request_id: "request-original", input }) });
}
function backgroundRequest(operation: string, input: unknown, bearer = false) {
  return new Request(`http://admin.local/api/internal/dream/v1/operations/${operation}`, { method: "POST", headers: {
    authorization: bearer ? "Bearer oauth-token" : "Bearer service-token",
    ...(bearer ? { "x-ink-dream-service-authorization": "Bearer service-token" } : {}),
    "content-type": "application/json", origin: "http://dream.local",
  }, body: JSON.stringify({ request_id: "request-builtin", input }) });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream", backgroundScopes: ["plugins:catalog"] }); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.receipt.mockImplementation(async (...args: unknown[]) => (args[4] as () => Promise<unknown>)());
});
afterEach(() => vi.unstubAllEnvs());

it("uses read scope and the complete identity/domain schema gate for catalog reads", async () => {
  mocks.run.mockResolvedValue({ installations: [], permissions: { can_manage_shared_plugins: true } });
  const response = await handleClaudePluginOperation(request("claude-plugin.installations.list", {}),
    "claude-plugin.installations.list");
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...claudePluginDataSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledWith(tx, "oauth-token", expect.anything(), "dream:read");
  expect(mocks.receipt).not.toHaveBeenCalled();
});

it("commits prepare/report under their original receipts and rejects query authority", async () => {
  const prepare = { source_kind: "package", package_spec: "demo@market", source_type: null };
  mocks.run.mockResolvedValueOnce({ accepted: true, operation_id: "cop_operation", package_spec: "demo@market",
    marketplace_entry_id: null, requested_source_type: null, marketplace_source: null });
  let response = await handleClaudePluginOperation(request("claude-plugin.install.prepare", prepare), "claude-plugin.install.prepare");
  expect(response.status).toBe(200);
  expect(mocks.principal).toHaveBeenLastCalledWith(tx, "oauth-token", expect.anything(), "dream:write");
  expect(mocks.receipt.mock.calls[0].slice(0, 3)).toEqual(["claude-plugin.install.prepare", "request-original", prepare]);

  const report = { event: "begin", operation_id: "cop_operation" };
  mocks.run.mockResolvedValueOnce({ id: "cop_operation", operation_kind: "install", requested_package_spec: "demo@market",
    marketplace_entry_id: null, status: "running", phase: "starting", progress: 5, message: "started",
    executable: null, argv_json: null, cwd: null, cli_version: null, exit_code: null, evidence_path: null,
    installation_id: null, error_code: null, error_summary: null, created_at: "2026-09-16T00:00:00Z",
    updated_at: "2026-09-16T00:00:00Z", finished_at: null });
  response = await handleClaudePluginOperation(request("claude-plugin.install.report", report), "claude-plugin.install.report");
  expect(response.status).toBe(200);
  expect(mocks.receipt.mock.calls[1].slice(0, 3)).toEqual(["claude-plugin.install.report", "request-original", report]);

  for (const key of ["actor_id", "user_id", "role", "sql", "table", "column", "transaction"]) {
    response = await handleClaudePluginOperation(request("claude-plugin.install.prepare", { ...prepare, [key]: "caller" }),
      "claude-plugin.install.prepare");
    expect(response.status).toBe(400);
  }
  expect(mocks.run).toHaveBeenCalledTimes(2);
});

it("uses service-only plugins:catalog authority and forbids browser credentials", async () => {
  mocks.run.mockResolvedValue({ action: "install", plan: { accepted: true, operation_id: "cop_builtin",
    package_spec: "ink-dream-story@platform-builtin", marketplace_entry_id: null,
    requested_source_type: "platform-builtin", marketplace_source: null } });
  let response = await handleClaudePluginOperation(backgroundRequest("claude-plugin.builtin.ensure",
    { package_spec: "ink-dream-story@platform-builtin" }), "claude-plugin.builtin.ensure");
  expect(response.status).toBe(200);
  expect(mocks.principal).not.toHaveBeenCalled();
  expect(mocks.receipt.mock.calls[0].slice(0, 3)).toEqual(["claude-plugin.builtin.ensure", "request-builtin",
    { package_spec: "ink-dream-story@platform-builtin" }]);

  response = await handleClaudePluginOperation(backgroundRequest("claude-plugin.builtin.ensure",
    { package_spec: "ink-dream-story@platform-builtin" }, true), "claude-plugin.builtin.ensure");
  expect(response.status).toBe(400);
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
