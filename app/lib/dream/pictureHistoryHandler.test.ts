// [Input] Registry103 read Handler with captured service, OAuth, UOW and domain seams.
// [Output] Exact body limit, principal derivation, no-receipt reads and fail-closed ingress evidence.
// [Pos] Provider-free picture-history HTTP boundary test; PostgreSQL filtering remains isolated evidence.
// [Sync] 2026-09-15: prove both reads use OAuth dream:read and reject caller selectors before UOW.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./pictureHistoryService", async original => ({ ...await original<typeof import("./pictureHistoryService")>(), runPictureHistoryOperation: mocks.run }));

import { AuthBoundaryError } from "../auth/config";
import { handlePictureHistory } from "./pictureHistoryHandler";
import { pictureHistorySchemaRequirements } from "./pictureHistoryService";
import { identitySchemaRequirement } from "./schemaRequirements";

const service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read"], status: "active" as const };
const list = { start_date: null, end_date: null, limit: 30 };
function request(input: unknown, name = "picture-history.list", token = "oauth") {
  return new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "picture-original", input }),
  });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.run.mockImplementation(async name => name === "picture-history.list" ? { pictures: [] } : { image_base64: null });
});
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["picture-history.list", list, { pictures: [] }],
  ["picture-history.full", { date: "2026-09-15" }, { image_base64: null }],
] as const)("executes %s once in a read-only receipt-free UOW", async (name, input, output) => {
  const response = await handlePictureHistory(request(input, name), name);
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ data: output, request_id: "picture-original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...pictureHistorySchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "oauth", service, "dream:read");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith(name, input, { principal, threadScope: null }, tx);
});

it("rejects identity, friendship and physical selectors before opening a UOW", async () => {
  for (const key of ["user_id", "actor", "friend_id", "subject", "sql", "table", "column"])
    expect((await handlePictureHistory(request({ ...list, [key]: "caller" }), "picture-history.list")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});

it.each([
  ["missing OAuth", new AuthBoundaryError("INVALID_ACCESS_TOKEN", 401), 401],
  ["wrong scope or entity grant", new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403), 403],
  ["missing capability", new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY"), 503],
] as const)("fails closed for %s", async (_label, error, status) => {
  if (status === 503) mocks.transaction.mockRejectedValueOnce(error); else mocks.principal.mockRejectedValueOnce(error);
  const response = await handlePictureHistory(request(list, "picture-history.list", status === 401 ? "" : "oauth"), "picture-history.list");
  expect(response.status).toBe(status); expect(mocks.run).not.toHaveBeenCalled();
});

it("rejects invalid dates and an unrelated operation before persistence", async () => {
  expect((await handlePictureHistory(request({ ...list, start_date: "2026-02-30" }), "picture-history.list")).status).toBe(400);
  expect((await handlePictureHistory(request(list), "picture-history.replace")).status).toBe(404);
  expect(mocks.transaction).not.toHaveBeenCalled();
});
