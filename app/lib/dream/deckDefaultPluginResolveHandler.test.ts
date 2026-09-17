// [Input] Registry104 Handler with captured service, OAuth, UOW and domain seams.
// [Output] Exact limit, capability list, no-receipt read and fail-closed ingress evidence.
// [Pos] Provider-free default-plugin HTTP boundary test; policy/filtering remain in Service/Repository.
// [Sync] 2026-09-15: prove OAuth dream:read and reject every caller selector before UOW.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./deckDefaultPluginResolveService", async original => ({
  ...await original<typeof import("./deckDefaultPluginResolveService")>(),
  runDeckDefaultPluginResolveOperation: mocks.run,
}));

import { AuthBoundaryError } from "../auth/config";
import { handleDeckDefaultPluginResolve } from "./deckDefaultPluginResolveHandler";
import { deckDefaultPluginResolveSchemaRequirements } from "./deckDefaultPluginResolveService";
import { identitySchemaRequirement } from "./schemaRequirements";

const service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read"], status: "active" as const };
function request(input: unknown, name = "deck.default-plugin.resolve", token = "oauth") {
  return new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "deck-default-original", input }),
  });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.run.mockResolvedValue({ installation: null });
});
afterEach(() => vi.unstubAllEnvs());

it("executes one OAuth read in the exact capability-checked UOW without a receipt", async () => {
  const response = await handleDeckDefaultPluginResolve(request({}), "deck.default-plugin.resolve");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: { installation: null }, request_id: "deck-default-original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...deckDefaultPluginResolveSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "oauth", service, "dream:read");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("deck.default-plugin.resolve", {}, { principal, threadScope: null }, tx);
});

it("rejects actor, policy, evidence and physical selectors before opening a UOW", async () => {
  for (const key of ["actor", "user_id", "thread_id", "package_name", "resolved_version", "plugin_installation_id", "evidence", "sql", "table", "column"])
    expect((await handleDeckDefaultPluginResolve(request({ [key]: "caller" }), "deck.default-plugin.resolve")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});

it("enforces the configured body limit before opening a UOW", async () => {
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "8");
  const response = await handleDeckDefaultPluginResolve(request({}), "deck.default-plugin.resolve");
  expect(response.status).toBe(413); expect((await response.json()).error.code).toBe("INPUT_TOO_LARGE");
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it.each([
  ["missing OAuth", new AuthBoundaryError("INVALID_ACCESS_TOKEN", 401), 401],
  ["wrong scope or entity grant", new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403), 403],
  ["missing capability", new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY"), 503],
] as const)("fails closed for %s", async (_label, error, status) => {
  if (status === 503) mocks.transaction.mockRejectedValueOnce(error); else mocks.principal.mockRejectedValueOnce(error);
  const response = await handleDeckDefaultPluginResolve(request({}, "deck.default-plugin.resolve", status === 401 ? "" : "oauth"), "deck.default-plugin.resolve");
  expect(response.status).toBe(status); expect(mocks.run).not.toHaveBeenCalled();
});

it("rejects an unrelated operation before persistence", async () => {
  const response = await handleDeckDefaultPluginResolve(request({}, "deck.default-plugin.list"), "deck.default-plugin.list");
  expect(response.status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled();
});
