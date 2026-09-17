// [Input] Registry134-147 OAuth/server-persistence envelopes and mocked Admin auth/UOW seams.
// [Output] Strict ingress, authority resolution, capability and write-receipt assertions.
// [Pos] Provider-free HTTP handler contract for the managed-MCP data domain.
// [Sync] 2026-09-16: verify one canonical ingress for browser and Agent Runtime callers.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: vi.fn(),
  principal: vi.fn(),
  resolve: vi.fn(),
  transaction: vi.fn(),
  run: vi.fn(),
  receiptExecute: vi.fn(),
}));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(),
  requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("../auth/delegationService", () => ({
  DelegationService: class {
    constructor(..._args: unknown[]) {}
    resolve = mocks.resolve;
  },
}));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./managedMcpService", async original => ({
  ...await original<typeof import("./managedMcpService")>(),
  runManagedMcpOperation: mocks.run,
}));
vi.mock("./receipts", () => ({
  ReceiptRepository: class {
    constructor(..._args: unknown[]) {}
    execute = mocks.receiptExecute;
  },
}));

import { handleManagedMcp } from "./managedMcpHandler";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { managedMcpSchemaRequirements } from "./managedMcpService";

const tx = { marker: "tx" };
const principal = {
  subject: "subject",
  canonical_user_id: "42",
  client_id: "dream",
  scopes: ["dream:read", "dream:write"],
  status: "active" as const,
};
const authority = { thread_id: "thread-1", workflow_run_id: `run_${"a".repeat(32)}` };
const serverId = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream-service" });
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.receiptExecute.mockImplementation(async (...args: unknown[]) => (args[4] as () => Promise<unknown>)());
});
afterEach(() => vi.unstubAllEnvs());

function request(operation: string, body: unknown, token = "oauth-token") {
  return new Request(`http://localhost/api/internal/dream/v1/operations/${operation}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

it("binds an OAuth read to the derived principal and managed-MCP capabilities", async () => {
  const input = { authority: null, workspace_id: null };
  mocks.run.mockResolvedValue({ servers: [] });
  const response = await handleManagedMcp(
    request("managed-mcp.servers.list", { request_id: "request-1", input }),
    "managed-mcp.servers.list",
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { servers: [] }, request_id: "request-1" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...managedMcpSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "oauth-token", { id: "dream-service" }, "dream:read");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(
    "managed-mcp.servers.list",
    input,
    { principal, threadScope: null, runScope: null, delegationPurpose: null },
    tx,
  );
  expect(mocks.receiptExecute).not.toHaveBeenCalled();
});

it("binds delegated reads to the exact server-persistence Thread and Run", async () => {
  const input = { authority, server_id: serverId };
  mocks.resolve.mockResolvedValue({
    principal,
    purpose: "server-persistence",
    threadId: authority.thread_id,
    runId: authority.workflow_run_id,
    editorSessionId: null,
  });
  mocks.run.mockResolvedValue({ credential: null });
  const response = await handleManagedMcp(
    request("managed-mcp.credential.get", { request_id: "request-2", input }, "idg_grant"),
    "managed-mcp.credential.get",
  );
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([
    identitySchemaRequirement,
    ...managedMcpSchemaRequirements,
    runtimeDelegationSchemaRequirement,
    runtimePurposeSchemaRequirement,
  ]);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
    "idg_grant", "dream:read", "dream-service", authority.thread_id, authority.workflow_run_id, null,
  );
  expect(mocks.principal).not.toHaveBeenCalled();
});

it("wraps writes in the operation receipt UOW with original authority", async () => {
  const input = { authority: null, server_id: serverId };
  mocks.run.mockResolvedValue({
    server: {
      id: serverId, user_id: "42", workspace_id: null, scope: "user", server_key: "example",
      display_name: "Example", transport: "streamable_http", remote_url: "https://mcp.example.test/connect",
      stdio_profile_key: null, auth_kind: "oauth", enabled: true, config_revision: 1,
      credential_revision: 0, credential_id: null, credential_configured: false,
      created_at: "2026-09-16T00:00:00.000Z", updated_at: "2026-09-16T00:00:00.000Z",
    },
  });
  const response = await handleManagedMcp(
    request("managed-mcp.credential.delete", { request_id: "request-3", input }),
    "managed-mcp.credential.delete",
  );
  expect(response.status).toBe(200);
  expect(mocks.receiptExecute.mock.calls[0].slice(0, 4)).toEqual([
    "managed-mcp.credential.delete", "request-3", input, expect.anything(),
  ]);
  expect(mocks.receiptExecute.mock.calls[0].slice(5)).toEqual([null, null, null]);
  expect(mocks.run).toHaveBeenCalledTimes(1);
});

it("rejects extra actor/SQL selectors and mismatched authority before domain I/O", async () => {
  for (const body of [
    { request_id: "request-4", input: { authority: null, workspace_id: null, actor_id: "42" } },
    { request_id: "request-4", input: { authority: null, workspace_id: null }, sql: "select 1" },
  ]) {
    expect((await handleManagedMcp(
      request("managed-mcp.servers.list", body), "managed-mcp.servers.list",
    )).status).toBe(400);
  }
  expect((await handleManagedMcp(
    request("managed-mcp.servers.list", { request_id: "request-4", input: { authority, workspace_id: null } }),
    "managed-mcp.servers.list",
  )).status).toBe(403);
  expect(mocks.run).not.toHaveBeenCalled();
});
