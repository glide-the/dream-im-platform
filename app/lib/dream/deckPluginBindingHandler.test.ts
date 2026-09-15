// [Input] Internal operation request, service/OAuth mocks and Registry122-129 Handler.
// [Output] Exact schema gates, principal scopes, read execution and write receipt ownership.
// [Pos] Provider-free Deck Plugin binding ingress verification.
// [Sync] 2026-09-16: lock OAuth-only binding/Runtime dispatch and atomic receipt behavior.
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ service: vi.fn(), transaction: vi.fn(), principal: vi.fn(), run: vi.fn(), receipt: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("./database", async original => ({ ...await original<typeof import("./database")>(), withDataTransaction: mocks.transaction }));
vi.mock("../auth/serviceAccessToken", async original => ({ ...await original<typeof import("../auth/serviceAccessToken")>(), principalForServiceToken: mocks.principal }));
vi.mock("./deckPluginBindingService", async original => ({ ...await original<typeof import("./deckPluginBindingService")>(), runDeckPluginBindingOperation: mocks.run }));
vi.mock("./receipts", () => ({ ReceiptRepository: class { execute(...args: unknown[]) { return mocks.receipt(...args); } } }));
import { handleDeckPluginBinding } from "./deckPluginBindingHandler";
import { deckPluginBindingSchemaRequirements } from "./deckPluginBindingService";
import { identitySchemaRequirement } from "./schemaRequirements";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "8192");
  mocks.service.mockReturnValue({ id: "dream", backgroundScopes: [] });
  mocks.principal.mockResolvedValue({ subject: "sub", canonical_user_id: "1", client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" });
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ tx: true }));
});

it("executes a read with dream:read and exact schema requirements", async () => {
  mocks.run.mockResolvedValue({ deck_id: "deck", binding_revision: 0, applied_to: "next_run", binding: null });
  const request = new Request("http://admin.local/operations/deck-plugin-binding.current", { method: "POST", headers: {
    authorization: "Bearer oauth", "content-type": "application/json", "x-ink-dream-service": "dream", "x-ink-dream-credential": "x".repeat(32), origin: "http://dream.local",
  }, body: JSON.stringify({ request_id: "req", input: { deck_id: "deck", workspace_id: "workspace" } }) });
  const response = await handleDeckPluginBinding(request, "deck-plugin-binding.current");
  expect(response.status).toBe(200); expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...deckPluginBindingSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledWith(expect.anything(), "oauth", expect.anything(), "dream:read");
  expect(mocks.receipt).not.toHaveBeenCalled();
});

it("wraps save in the original actor receipt", async () => {
  const result = { deck_plugin_binding_id: `dpb_${"1".repeat(32)}`, deck_id: "deck", deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", binding_revision: 1, status: "active", applied_to: "next_run",
    selection_validation_summary: { selectable: true, release_status: "published", installation_status: "ready", compatibility: "passed", runtime_readiness: "materialized", reason_code: null, recovery: null, capability_summary: [] } };
  mocks.receipt.mockResolvedValue(result);
  const input = { deck_id: "deck", workspace_id: "workspace", deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", apply_to: "next_run", expected_binding_revision: 0 };
  const request = new Request("http://admin.local/operations/deck-plugin-binding.save", { method: "POST", headers: {
    authorization: "Bearer oauth", "content-type": "application/json", "x-ink-dream-service": "dream", "x-ink-dream-credential": "x".repeat(32), origin: "http://dream.local",
  }, body: JSON.stringify({ request_id: "req", input }) });
  const response = await handleDeckPluginBinding(request, "deck-plugin-binding.save");
  expect(response.status).toBe(200); expect(mocks.principal).toHaveBeenCalledWith(expect.anything(), "oauth", expect.anything(), "dream:write");
  expect(mocks.receipt).toHaveBeenCalledWith("deck-plugin-binding.save", "req", input, expect.anything(), expect.any(Function));
});
