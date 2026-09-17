// [Input] Real Chat/user-message handlers and original receipt ingress with a resolved task authority seam.
// [Output] Four Chat-side allowlist entries, exact Thread binding and same-subject receipt recovery evidence.
// [Pos] Reflections child-authority ingress gate; Thread-config and Session-list entries have focused handler tests.
// [Sync] 2026-09-15: prove exact operation names reach authority resolution without a generic service bypass.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AuthBoundaryError } from "../auth/config";

const allowed = new Set(["chat-user-message.persist", "chat-message.persist", "chat-thread.get", "chat-thread.update-session"]);
const mocks = vi.hoisted(() => ({
  service: vi.fn(), principal: vi.fn(), transaction: vi.fn(), resolveReflection: vi.fn(), runChat: vi.fn(), runUser: vi.fn(),
  receiptActor: vi.fn(), execute: vi.fn(), find: vi.fn(),
}));
vi.mock("../auth/serviceIdentity", async original => ({ ...await original<typeof import("../auth/serviceIdentity")>(), requireDreamService: mocks.service }));
vi.mock("../auth/serviceAccessToken", () => ({ principalForServiceToken: mocks.principal }));
vi.mock("./database", () => ({ withDataTransaction: mocks.transaction }));
vi.mock("./reflectionTaskAuthorityService", () => ({ resolveReflectionTaskAuthority: mocks.resolveReflection }));
vi.mock("./chatThreadService", async original => ({ ...await original<typeof import("./chatThreadService")>(), runChatThreadOperation: mocks.runChat }));
vi.mock("./userMessageService", () => ({ persistCanonicalUserMessage: mocks.runUser }));
vi.mock("./receipts", () => ({ ReceiptRepository: class {
  constructor(_tx: unknown, serviceId: string, actor: string) { mocks.receiptActor(serviceId, actor); }
  async execute(operation: string, requestId: string, input: unknown, output: unknown, action: () => Promise<unknown>, threadScope?: string | null) {
    mocks.execute(operation, requestId, input, output, threadScope); return action();
  }
  find = mocks.find;
} }));

import { handleChatThreadOperation } from "./chatThreadHandler";
import { handleUserMessage } from "./userMessageHandler";
import { GET } from "../../api/internal/dream/v1/receipts/[requestId]/route";
import { reflectionTaskSchemaRequirement } from "./schemaRequirements";

const token = `rta_${"a".repeat(43)}`, thread = "22222222-2222-4222-8222-222222222222", tx = { marker: "tx" };
const service = { id: "service", backgroundScopes: ["reflections:execute"] };
const principal = { subject: "reflection-subject", canonical_user_id: "9007199254740993", client_id: "reflections-worker:service", scopes: ["dream:read", "dream:write"], status: "active" as const };
function request(operation: string, input: unknown) {
  return new Request(`http://localhost/api/internal/dream/v1/operations/${operation}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ request_id: "original", input }),
  });
}
const cases = [
  ["chat-thread.get", { thread_id: thread }, { thread: null }],
  ["chat-thread.update-session", { thread_id: thread, claude_session_id: "session", agent_contract_version: "v1" }, { changed: true }],
  ["chat-message.persist", { thread_id: thread, message_id: "message", role: "user", parts: [], metadata: null, history_final_text: null, history_process_available: false, history_projection_version: null }, { message_id: "message" }],
] as const;
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv("DREAM_DATA_MAX_BODY_BYTES", "65536");
  mocks.service.mockReturnValue(service);
  mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.resolveReflection.mockImplementation(async (_tx, _token, operation: string) => {
    if (!allowed.has(operation)) throw new AuthBoundaryError("REFLECTION_AUTHORITY_OPERATION_DENIED", 403);
    return { principal, serviceClientId: service.id, threadScope: thread, runScope: null, editorSessionScope: null, purpose: "reflections-worker" };
  });
  mocks.runChat.mockImplementation(async (operation: string) => cases.find(item => item[0] === operation)?.[2] ?? { changed: false });
  mocks.runUser.mockResolvedValue({ message_id: "user-message", confirmation_preserved: false });
  mocks.find.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

it.each(cases)("connects task authority to the real %s handler with exact operation and Thread", async (operation, input, output) => {
  const response = await handleChatThreadOperation(request(operation, input), operation);
  expect(response.status).toBe(200); expect((await response.json()).data).toEqual(output);
  expect(mocks.resolveReflection).toHaveBeenCalledExactlyOnceWith(tx, token, operation, service.id);
  expect(mocks.transaction.mock.calls[0][0]).toContainEqual(reflectionTaskSchemaRequirement);
  expect(mocks.runChat).toHaveBeenCalledExactlyOnceWith(operation, input, { principal, threadScope: thread, runScope: null }, tx);
  expect(mocks.principal).not.toHaveBeenCalled();
});

it("connects task authority to the real canonical user-message handler", async () => {
  const input = { thread_id: thread, message_id: "user-message", parts_json: "[]", metadata_json: null, title_candidate: "Title" };
  const response = await handleUserMessage(request("chat-user-message.persist", input));
  expect(response.status).toBe(200);
  expect(mocks.resolveReflection).toHaveBeenCalledExactlyOnceWith(tx, token, "chat-user-message.persist", service.id);
  expect(mocks.transaction.mock.calls[0][0]).toContainEqual(reflectionTaskSchemaRequirement);
  expect(mocks.runUser).toHaveBeenCalledExactlyOnceWith(tx, { principal, threadScope: thread, runScope: null }, input);
});

it("rejects a cross-Thread authority and a non-allowlisted Chat operation before domain execution", async () => {
  mocks.resolveReflection.mockResolvedValueOnce({ principal, serviceClientId: service.id, threadScope: "other", runScope: null, editorSessionScope: null, purpose: "reflections-worker" });
  let response = await handleChatThreadOperation(request("chat-thread.get", { thread_id: thread }), "chat-thread.get");
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("REFLECTION_AUTHORITY_ENTITY_DENIED");
  response = await handleChatThreadOperation(request("chat-thread.delete", { thread_id: thread }), "chat-thread.delete");
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("REFLECTION_AUTHORITY_OPERATION_DENIED");
  expect(mocks.runChat).not.toHaveBeenCalled();
});

it("recovers a child write only under the same authority subject and Thread", async () => {
  mocks.find.mockResolvedValue({ inputSha256: "b".repeat(64), threadScope: thread, editorSessionScope: null, runScope: null, result: { message_id: "message" } });
  const url = "http://localhost/api/internal/dream/v1/receipts/original?operation=chat-message.persist";
  let response = await GET(new Request(url, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(200);
  expect((await response.json()).data).toEqual({ status: "committed", operation: "chat-message.persist", request_id: "original", result: { message_id: "message" } });
  expect(mocks.resolveReflection).toHaveBeenCalledExactlyOnceWith(tx, token, "chat-message.persist", service.id);
  expect(mocks.receiptActor).toHaveBeenCalledExactlyOnceWith(service.id, principal.subject);
  expect(mocks.find).toHaveBeenCalledExactlyOnceWith("chat-message.persist", "original");

  vi.resetAllMocks(); mocks.service.mockReturnValue(service); mocks.transaction.mockImplementation(async (_requirements, action) => action(tx));
  mocks.resolveReflection.mockResolvedValue({ principal, serviceClientId: service.id, threadScope: thread, runScope: null, editorSessionScope: null, purpose: "reflections-worker" });
  mocks.find.mockResolvedValue({ inputSha256: "b".repeat(64), threadScope: "other", editorSessionScope: null, runScope: null, result: { message_id: "message" } });
  response = await GET(new Request(url, { headers: { authorization: `Bearer ${token}` } }), { params: Promise.resolve({ requestId: "original" }) });
  expect(response.status).toBe(403); expect((await response.json()).error.code).toBe("DELEGATION_ENTITY_DENIED");
});
