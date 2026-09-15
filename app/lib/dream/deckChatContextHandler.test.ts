// [Input] Registry105 Handler with captured service, OAuth, UOW and domain seams.
// [Output] Exact body limit, capability list, no-receipt read and fail-closed ingress evidence.
// [Pos] Provider-free Deck chat-context HTTP boundary test; domain rules stay in Service/Repository.
// [Sync] 2026-09-15: prove OAuth dream:read and reject caller authority/runtime/physical selectors.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), run: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./deckChatContextService", async original => ({
  ...await original<typeof import("./deckChatContextService")>(),
  runDeckChatContextOperation: mocks.run,
}));

import { AuthBoundaryError } from "../auth/config";
import { handleDeckChatContext } from "./deckChatContextHandler";
import { deckChatContextSchemaRequirements } from "./deckChatContextService";
import { identitySchemaRequirement } from "./schemaRequirements";

const service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read"], status: "active" as const };
const input = { deck_id: "deck-1", voice_id: null };
const output = { deck: { id: "deck-1", name: "Deck", name_zh: null, name_en: null, description: null, description_zh: null, description_en: null }, voices: [], plugin_refs: [] };
function request(rawInput: unknown, name = "deck-chat-context.resolve", token = "oauth") {
  return new Request(`http://localhost/api/internal/dream/v1/operations/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ request_id: "deck-chat-context-original", input: rawInput }),
  });
}

beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue(service); mocks.principal.mockResolvedValue(principal);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.run.mockResolvedValue(output);
});
afterEach(() => vi.unstubAllEnvs());

it("executes one OAuth read in the exact capability-checked UOW without a receipt", async () => {
  const response = await handleDeckChatContext(request(input), "deck-chat-context.resolve");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ data: output, request_id: "deck-chat-context-original" });
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement, ...deckChatContextSchemaRequirements]);
  expect(mocks.principal).toHaveBeenCalledExactlyOnceWith(tx, "oauth", service, "dream:read");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("deck-chat-context.resolve", input, { principal, threadScope: null }, tx);
});

it("rejects actor, runtime and physical selectors before opening a UOW", async () => {
  for (const key of ["actor_id", "user_id", "thread_id", "prompt_mode", "dream_mode", "path", "sql", "table", "column"])
    expect((await handleDeckChatContext(request({ ...input, [key]: "caller" }), "deck-chat-context.resolve")).status).toBe(400);
  expect(mocks.transaction).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
});

it("enforces the configured body limit before opening a UOW", async () => {
  vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "8");
  const response = await handleDeckChatContext(request(input), "deck-chat-context.resolve");
  expect(response.status).toBe(413); expect((await response.json()).error.code).toBe("INPUT_TOO_LARGE");
  expect(mocks.transaction).not.toHaveBeenCalled();
});

it.each([
  ["missing OAuth", new AuthBoundaryError("INVALID_ACCESS_TOKEN", 401), 401],
  ["wrong scope or entity grant", new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403), 403],
  ["missing capability", new AuthBoundaryError("DREAM_DATA_SCHEMA_NOT_READY"), 503],
] as const)("fails closed for %s", async (_label, error, status) => {
  if (status === 503) mocks.transaction.mockRejectedValueOnce(error); else mocks.principal.mockRejectedValueOnce(error);
  const response = await handleDeckChatContext(request(input, "deck-chat-context.resolve", status === 401 ? "" : "oauth"), "deck-chat-context.resolve");
  expect(response.status).toBe(status); expect(mocks.run).not.toHaveBeenCalled();
});

it("rejects an unrelated operation before persistence", async () => {
  const response = await handleDeckChatContext(request(input, "deck-chat-context.list"), "deck-chat-context.list");
  expect(response.status).toBe(404); expect(mocks.transaction).not.toHaveBeenCalled();
});
