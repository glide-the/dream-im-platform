// [Input] Registry170-174 HTTP envelopes, mocked service identity/OAuth principal and Admin UOW seams.
// [Output] Strict body, capability, schema-gate and original-receipt assertions.
// [Pos] Provider-free Deck Plugin control ingress test.
// [Sync] 2026-09-17: verify dual-bearer user delegation after service OAuth cutover.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), transaction: vi.fn(), principal: vi.fn(), run: vi.fn(), receipt: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("./database", async original => ({ ...await original<typeof import("./database")>(), withDataTransaction: mocks.transaction }));
vi.mock("../auth/serviceAccessToken", async original => ({ ...await original<typeof import("../auth/serviceAccessToken")>(), principalForServiceToken: mocks.principal }));
vi.mock("./deckPluginControlService", async original => ({ ...await original<typeof import("./deckPluginControlService")>(), runDeckPluginControlOperation: mocks.run }));
vi.mock("./receipts", () => ({ ReceiptRepository: class { constructor(..._args: unknown[]) {} execute = mocks.receipt; } }));

import { handleDeckPluginControl } from "./deckPluginControlHandler";
import { deckPluginControlSchemaRequirements } from "./deckPluginControlService";
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

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue({ id: "dream" }); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.receipt.mockImplementation(async (...args: unknown[]) => (args[4] as () => Promise<unknown>)());
});
afterEach(() => vi.unstubAllEnvs());

it("executes owner-scoped reads and plans with their exact OAuth scopes", async () => {
  mocks.run.mockResolvedValueOnce({ installations: [], runtime_plugins: [] });
  let response = await handleDeckPluginControl(request("deck-plugin-control.list", {
    scope_type: "workspace", scope_id: "workspace",
  }), "deck-plugin-control.list");
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...deckPluginControlSchemaRequirements]);
  expect(mocks.principal).toHaveBeenLastCalledWith(tx, "oauth-token", expect.anything(), "dream:read");
  expect(mocks.receipt).not.toHaveBeenCalled();

  const command = { action: "disable", scope_type: "workspace", scope_id: "workspace",
    deck_plugin_id: "example.story", reason: "maintenance" };
  mocks.run.mockResolvedValueOnce({ command, expected_revision: 1,
    deck_plugin_installation_id: `dpi_${"d".repeat(32)}`, target_version: "1.0.0", source_policy_id: null,
    capability_diff: { added: [], removed: [] }, requires_runtime_evidence: false, runtime_target: null });
  response = await handleDeckPluginControl(request("deck-plugin-control.plan", command), "deck-plugin-control.plan");
  expect(response.status).toBe(200); expect(mocks.principal).toHaveBeenLastCalledWith(tx, "oauth-token", expect.anything(), "dream:write");
  expect(mocks.receipt).not.toHaveBeenCalled();
});

it("wraps apply in the canonical actor receipt and rejects authority/database selectors", async () => {
  const command = { action: "disable", scope_type: "workspace", scope_id: "workspace",
    deck_plugin_id: "example.story", reason: "maintenance" };
  const input = { plan: { command, expected_revision: 1, deck_plugin_installation_id: `dpi_${"d".repeat(32)}`,
    target_version: "1.0.0", source_policy_id: null, capability_diff: { added: [], removed: [] },
    requires_runtime_evidence: false, runtime_target: null }, evidence: [] };
  mocks.run.mockResolvedValue({ operation_id: `op_${"a".repeat(32)}`, deck_plugin_id: "example.story",
    target_version: "1.0.0", status: "completed", phase: "ready", progress: 100,
    message: "Deck Plugin disable completed.", updated_at: "2026-09-16T00:00:00Z" });
  let response = await handleDeckPluginControl(request("deck-plugin-control.apply", input), "deck-plugin-control.apply");
  expect(response.status).toBe(200);
  expect(mocks.receipt.mock.calls[0].slice(0, 3)).toEqual(["deck-plugin-control.apply", "request-original", input]);
  for (const key of ["actor_id", "user_id", "role", "sql", "table", "column", "transaction"]) {
    response = await handleDeckPluginControl(request("deck-plugin-control.plan", { ...command, [key]: "caller" }), "deck-plugin-control.plan");
    expect(response.status).toBe(400);
  }
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
