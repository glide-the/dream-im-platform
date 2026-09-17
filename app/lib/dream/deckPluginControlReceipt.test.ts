// [Input] Registry174 original apply request ID plus the current delegated OAuth subject.
// [Output] Strict committed/absent recovery; read/plan operations and extra selectors remain unavailable.
// [Pos] Provider-free unknown-COMMIT recovery test; it never reissues Deck Plugin apply.
// [Sync] 2026-09-17: add the missing Registry174 receipt boundary.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), find: vi.fn(), construct: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({
  ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service,
}));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  constructor(...args: unknown[]) { mocks.construct(...args); }
  find = mocks.find;
} }));

import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { identitySchemaRequirement } from "./schemaRequirements";
import { deckPluginControlSchemaRequirements } from "./deckPluginControlService";

const requestId = "deck-plugin-install:" + "a".repeat(64);
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream",
  scopes: ["dream:write"], status: "active" as const };
const result = { operation_id: `op_${"b".repeat(32)}`, deck_plugin_id: "ink.dream.story-workflow",
  target_version: "1.0.0", status: "completed", phase: "ready", progress: 100,
  message: "Deck Plugin installed and runtime lock materialized.", updated_at: "2026-09-17T00:00:00Z" };

function read(operation: string, suffix = "") {
  return GET(new Request(
    `http://localhost/api/internal/dream/v1/receipts/${requestId}?operation=${operation}${suffix}`,
    { headers: { authorization: "Bearer oauth-token", "x-ink-dream-service-authorization": "Bearer service-token" } },
  ), { params: Promise.resolve({ requestId }) });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.service.mockReturnValue({ id: "dream-service" });
  mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action({ marker: "tx" }));
});

it("recovers the exact committed apply DTO under the original OAuth subject", async () => {
  mocks.find.mockResolvedValue({ inputSha256: "c".repeat(64), result,
    threadScope: null, editorSessionScope: null, runScope: null });
  const response = await read("deck-plugin-control.apply");
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ status: "committed",
    operation: "deck-plugin-control.apply", request_id: requestId, result });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([
    identitySchemaRequirement, ...deckPluginControlSchemaRequirements,
  ]);
  expect(mocks.principal).toHaveBeenCalledWith({ marker: "tx" }, "oauth-token", { id: "dream-service" }, "dream:write");
  expect(mocks.construct).toHaveBeenCalledExactlyOnceWith({ marker: "tx" }, "dream-service", "subject");
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith("deck-plugin-control.apply", requestId);
});

it("returns absence and rejects read receipts, selectors, and malformed stored evidence", async () => {
  mocks.find.mockResolvedValueOnce(null);
  const absent = await read("deck-plugin-control.apply");
  expect(absent.status).toBe(200);
  expect((await absent.json()).data).toEqual({ status: "absent",
    operation: "deck-plugin-control.apply", request_id: requestId });
  expect((await read("deck-plugin-control.plan")).status).toBe(404);
  expect((await read("deck-plugin-control.apply", "&workspace_id=workspace")).status).toBe(404);
  mocks.find.mockResolvedValueOnce({ inputSha256: "invalid", result,
    threadScope: null, editorSessionScope: null, runScope: null });
  const invalid = await read("deck-plugin-control.apply");
  expect(invalid.status).toBe(503);
  expect((await invalid.json()).error.code).toBe("DECK_PLUGIN_CONTROL_DATA_INVALID");
});
