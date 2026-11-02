// [Input] Registry105 Handler with captured service, OAuth/Thread grant, UOW and domain seams.
// [Output] Exact body limit, capability list, no-receipt read and fail-closed ingress evidence.
// [Pos] Provider-free Deck chat-context HTTP boundary test; Dream owns enabled/ready policy.
// [Sync] 2026-09-15: prove OAuth dream:read and return only typed storage status facts.
// [Sync] 2026-09-28: verify claim-bound server-persistence reads and reject other purposes.
// [Sync] 2026-10-26: require the same active Run before Run-bound Deck/Voice reads and retain ordinary source-Thread behavior.
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ service: vi.fn(), principal: vi.fn(), delegation: vi.fn(), transaction: vi.fn(), run: vi.fn(), context: vi.fn() }));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("../auth/delegationService", () => ({ DelegationService: class { resolve = mocks.delegation; } }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./workflowContextService", () => ({ authoritativeWorkflowContext: mocks.context }));
vi.mock("./deckChatContextService", async original => ({
  ...await original<typeof import("./deckChatContextService")>(),
  runDeckChatContextOperation: mocks.run,
}));

import { AuthBoundaryError } from "../auth/config";
import { handleDeckChatContext } from "./deckChatContextHandler";
import { deckChatContextSchemaRequirements } from "./deckChatContextService";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";

const service = { id: "service" }, tx = { marker: "tx" };
const principal = { subject: "subject", canonical_user_id: "9007199254740993", client_id: "browser", scopes: ["dream:read"], status: "active" as const };
const input = { deck_id: "deck-1", voice_id: null };
const output = { deck: { id: "deck-1", name: "Deck", name_zh: null, name_en: null, description: null, description_zh: null, description_en: null, enabled: true }, voices: [], plugin_refs: [] };
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
  mocks.delegation.mockResolvedValue({ principal, threadId: "source-thread", runId: null, editorSessionId: null, purpose: "server-persistence" });
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.run.mockResolvedValue(output);
  mocks.context.mockResolvedValue(null);
});

it("limits a delegated read to a live source Thread persistence grant", async () => {
  const response = await handleDeckChatContext(request(input, "deck-chat-context.resolve", "idg_source"), "deck-chat-context.resolve");
  expect(response.status).toBe(200);
  expect(mocks.transaction.mock.calls[0][0]).toEqual([identitySchemaRequirement,
    ...deckChatContextSchemaRequirements, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement]);
  expect(mocks.delegation).toHaveBeenCalledExactlyOnceWith("idg_source", "dream:read", service.id, undefined, undefined, null);
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("deck-chat-context.resolve", input,
    { principal, threadScope: "source-thread" }, tx);
  expect(mocks.principal).not.toHaveBeenCalled();
  expect(mocks.context).not.toHaveBeenCalled();
});

it("reads the original Thread-bound Deck only after its Run grant matches stored context", async () => {
  const runId = `run_${"a".repeat(32)}`;
  mocks.delegation.mockResolvedValueOnce({ principal, threadId: "source-thread", runId, editorSessionId: null, purpose: "server-persistence" });
  mocks.context.mockResolvedValueOnce({ workflow_run_id: runId });
  const response = await handleDeckChatContext(request(input, "deck-chat-context.resolve", "idg_run"), "deck-chat-context.resolve");
  expect(response.status).toBe(200);
  expect(mocks.context).toHaveBeenCalledExactlyOnceWith(tx, principal.canonical_user_id, "source-thread");
  expect(mocks.run).toHaveBeenCalledExactlyOnceWith("deck-chat-context.resolve", input,
    { principal, threadScope: "source-thread" }, tx);
  expect(mocks.principal).not.toHaveBeenCalled();
});

it.each([null, { workflow_run_id: `run_${"b".repeat(32)}` }])("rejects a Run grant with missing or different active context", async context => {
  mocks.delegation.mockResolvedValueOnce({ principal, threadId: "source-thread", runId: `run_${"a".repeat(32)}`, editorSessionId: null, purpose: "server-persistence" });
  mocks.context.mockResolvedValueOnce(context);
  const response = await handleDeckChatContext(request(input, "deck-chat-context.resolve", "idg_run"), "deck-chat-context.resolve");
  expect(response.status).toBe(403);
  expect((await response.json()).error.code).toBe("DELEGATION_ENTITY_DENIED");
  expect(mocks.run).not.toHaveBeenCalled();
});

it.each([
  ["expired or revoked", "DELEGATION_REQUIRED", 401],
  ["different service or editor", "DELEGATION_ENTITY_DENIED", 403],
] as const)("propagates %s grant rejection before context reads", async (_label, code, status) => {
  mocks.delegation.mockRejectedValueOnce(new AuthBoundaryError(code, status));
  const response = await handleDeckChatContext(request(input, "deck-chat-context.resolve", "idg_run"), "deck-chat-context.resolve");
  expect(response.status).toBe(status);
  expect(mocks.context).not.toHaveBeenCalled();
  expect(mocks.run).not.toHaveBeenCalled();
});

it("rejects a non-persistence Thread grant before reading the Deck", async () => {
  mocks.delegation.mockResolvedValueOnce({ principal, threadId: "source-thread", purpose: "gateway-cli" });
  const response = await handleDeckChatContext(request(input, "deck-chat-context.resolve", "idg_gateway"), "deck-chat-context.resolve");
  expect(response.status).toBe(403);
  expect(mocks.run).not.toHaveBeenCalled();
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
