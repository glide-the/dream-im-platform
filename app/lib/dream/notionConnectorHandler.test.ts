// [Input] OAuth/delegated/background Notion envelopes and mocked Admin auth/UOW seams.
// [Output] Strict ingress, capability, background-scope and write-receipt assertions.
// [Pos] Provider-free HTTP handler contract for the Notion connector data domain.
// [Sync] 2026-09-17: distinguish client_credentials scheduler calls from dual-bearer user delegation.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  service: vi.fn(), principal: vi.fn(), resolve: vi.fn(), transaction: vi.fn(),
  userRun: vi.fn(), backgroundRun: vi.fn(), receiptExecute: vi.fn(),
}));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("../auth/delegationService", () => ({
  DelegationService: class { constructor(..._args: unknown[]) {} resolve = mocks.resolve; },
}));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./notionConnectorService", async original => ({
  ...await original<typeof import("./notionConnectorService")>(),
  runNotionConnectorUserOperation: mocks.userRun,
  runNotionConnectorBackgroundOperation: mocks.backgroundRun,
}));
vi.mock("./receipts", () => ({
  ReceiptRepository: class {
    constructor(..._args: unknown[]) {}
    execute = mocks.receiptExecute;
  },
}));

import { handleNotionConnector } from "./notionConnectorHandler";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { notionConnectorSchemaRequirements } from "./notionConnectorService";

const tx = { marker: "tx" };
const principal = {
  subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:read", "dream:write"], status: "active" as const,
};
const connectorId = "00000000-0000-4000-8000-000000000001";
const authority = { thread_id: "thread-1", workflow_run_id: `run_${"a".repeat(32)}` };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream-service", backgroundScopes: ["connectors:sync"] });
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.receiptExecute.mockImplementation(async (...args: unknown[]) => (args[4] as () => Promise<unknown>)());
});
afterEach(() => vi.unstubAllEnvs());

function request(operation: string, input: unknown, token: string | null = "oauth-token") {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${token ?? "service-token"}`,
  };
  if (token !== null) headers["x-ink-dream-service-authorization"] = "Bearer service-token";
  return new Request(`http://localhost/api/internal/dream/v1/operations/${operation}`, {
    method: "POST", headers, body: JSON.stringify({ request_id: "request-1", input }),
  });
}

it("binds OAuth reads to the derived principal", async () => {
  mocks.userRun.mockResolvedValue({ connectors: [] });
  const response = await handleNotionConnector(request("notion.connector.list", { authority: null }), "notion.connector.list");
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...notionConnectorSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "oauth-token", expect.objectContaining({ id: "dream-service" }), "dream:read");
  expect(mocks.receiptExecute).not.toHaveBeenCalled();
});

it("binds delegated Runtime reads to the exact authority", async () => {
  mocks.resolve.mockResolvedValue({
    principal, purpose: "server-persistence", threadId: authority.thread_id,
    runId: authority.workflow_run_id, editorSessionId: null,
  });
  mocks.userRun.mockResolvedValue({ connector: null });
  const response = await handleNotionConnector(
    request("notion.connector.get", { authority, connector_id: connectorId }, "idg_grant"),
    "notion.connector.get",
  );
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([
    identitySchemaRequirement, ...notionConnectorSchemaRequirements,
    runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement,
  ]);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(
    "idg_grant", "dream:read", "dream-service", authority.thread_id, authority.workflow_run_id, null,
  );
});

it("wraps user and scheduled writes in receipts with separate subjects", async () => {
  mocks.userRun.mockResolvedValue({ deleted: true });
  let response = await handleNotionConnector(
    request("notion.connector.delete", { authority: null, connector_id: connectorId }),
    "notion.connector.delete",
  );
  expect(response.status).toBe(200);
  expect(mocks.receiptExecute.mock.calls[0].slice(0, 3)).toEqual([
    "notion.connector.delete", "request-1", { authority: null, connector_id: connectorId },
  ]);

  mocks.backgroundRun.mockResolvedValue({ connector: null });
  response = await handleNotionConnector(
    request("notion.sync-connector.patch", { connector_id: connectorId, patch: { auth_status: "error" } }, null),
    "notion.sync-connector.patch",
  );
  expect(response.status).toBe(200);
  expect(mocks.backgroundRun).toHaveBeenCalledTimes(1);
  expect(mocks.principal).toHaveBeenCalledTimes(1);
});

it("rejects browser Authorization on scheduler operations and caller-authored user IDs", async () => {
  expect((await handleNotionConnector(
    request("notion.sync-candidates.list", {}, "oauth-token"), "notion.sync-candidates.list",
  )).status).toBe(400);
  expect((await handleNotionConnector(
    request("notion.connector.list", { authority: null, user_id: "42" }), "notion.connector.list",
  )).status).toBe(400);
  expect(mocks.backgroundRun).not.toHaveBeenCalled();
});
