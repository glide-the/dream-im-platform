// [Input] Authenticated turn authority and controlled original repository/transaction boundaries.
// [Output] Fail-closed bind/selection authorization, source digest and original deterministic receipt evidence.
// [Pos] Provider-free named domain tests; no real user, Gateway call or database mutation.
// [Sync] 2026-10-10: verify service ownership and provenance without a parallel state machine.
import { beforeEach, expect, it, vi } from "vitest";
import type { DelegatedPrincipal } from "../auth/delegationService";
import type { DataTransaction } from "./database";
import { ReceiptRepository, operationInputDigest } from "./receipts";
import { ChatThreadRepository } from "./chatThreadRepository";
import { executeImageTurnOperation } from "./imageTurnService";
import { imageTurnReceiptKey } from "./imageTurnDto";
const turnKey = "dream-turn-" + "a".repeat(64), key = imageTurnReceiptKey(turnKey);
const authority = { principal: { subject: "subject", canonical_user_id: "102", client_id: "oauth", status: "active", scopes: ["dream:write"] },
  serviceClientId: "service", threadId: "thread", runId: null, purpose: "server-persistence", editorSessionId: null,
  tokenHash: "private", gatewayApiKeyId: null } as DelegatedPrincipal;
const binding = { thread_id: "thread", turn_id: "actual-turn", turn_key: turnKey, message_id: "actual-message", ai_model: "main-ai",
  image_model: "selected-image", materials: [] };
const argumentsDto = { operation: "native_generate", prompt: "Actual request", reference_images: [] };
const selection = { thread_id: "thread", turn_key: turnKey, source_call_id: "actual_call", arguments: argumentsDto };
let execute: ReturnType<typeof vi.spyOn>, find: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(ChatThreadRepository.prototype, "requireOwned").mockResolvedValue(undefined);
  execute = vi.spyOn(ReceiptRepository.prototype, "execute").mockImplementation(async (_operation, _id, _input, output, action) => output.parse(await action()));
  find = vi.spyOn(ReceiptRepository.prototype, "find").mockImplementation(async (name) => {
    const data = name === "image-turn.bind" ? { ...binding, canonical_user_id: "102", run_id: null }
      : name === "image-turn.source" ? { call_id: "actual_call", output_item_id: "actual_item", gateway_request_id: "req_" + "c".repeat(32),
        tool_name: "mcp__image_gen__select_image_operation", arguments_sha256: operationInputDigest(argumentsDto) } : null;
    return data === null ? null : { inputSha256: operationInputDigest(data), result: data, threadScope: "thread", runScope: null, editorSessionScope: null };
  });
});
const transaction = () => ({ execute: vi.fn().mockResolvedValue({ rows: [{ id: "actual-message" }] }) } as unknown as DataTransaction);
it("uses the original saved user message and server identity in the deterministic binding receipt", async () => {
  expect(await executeImageTurnOperation(transaction(), authority, "image-turn.bind", key, binding)).toEqual({ ...binding, canonical_user_id: "102", run_id: null });
  expect(execute).toHaveBeenCalledWith("image-turn.bind", key, binding, expect.anything(), expect.any(Function), "thread", null, null);
});
it.each([{ purpose: "gateway-cli" }, { threadId: "other" }, { editorSessionId: "editor" }, { principal: { ...authority.principal, scopes: [] } }])("rejects mismatched authority before writing %j", async (changed) => {
  await expect(executeImageTurnOperation(transaction(), { ...authority, ...changed } as DelegatedPrincipal, "image-turn.bind", key, binding)).rejects.toMatchObject({ code: "IMAGE_TURN_AUTHORITY_REQUIRED" });
  expect(execute).not.toHaveBeenCalled();
});
it("does not permit a changed request key to create another binding", async () => {
  await expect(executeImageTurnOperation(transaction(), authority, "image-turn.bind", "other-key", binding)).rejects.toMatchObject({ code: "IMAGE_TURN_REQUEST_ID_INVALID" });
  expect(execute).not.toHaveBeenCalled();
});
it("rejects an absent saved message before binding", async () => {
  const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) } as unknown as DataTransaction;
  await expect(executeImageTurnOperation(tx, authority, "image-turn.bind", key, binding)).rejects.toMatchObject({ code: "IMAGE_TURN_MESSAGE_NOT_FOUND" });
  expect(execute).not.toHaveBeenCalled();
});
it("accepts only the exact source parameters and keeps prompt out of the persisted result", async () => {
  const result = await executeImageTurnOperation(transaction(), authority, "image-turn.select", key, selection);
  expect(result).toEqual({ turn_key: turnKey, source_call_id: "actual_call", operation: "native_generate",
    arguments_sha256: operationInputDigest(argumentsDto), reference_images: [] });
  expect(JSON.stringify(result)).not.toContain("Actual request");
  await expect(executeImageTurnOperation(transaction(), authority, "image-turn.select", key,
    { ...selection, arguments: { ...argumentsDto, prompt: "Substituted request" } })).rejects.toMatchObject({ code: "IMAGE_TURN_SOURCE_MISMATCH" });
});
it("rejects absent source and different materials without changing the original decision", async () => {
  find.mockResolvedValue(null);
  await expect(executeImageTurnOperation(transaction(), authority, "image-turn.select", key, selection)).rejects.toMatchObject({ code: "IMAGE_TURN_NOT_BOUND" });
  expect(execute).not.toHaveBeenCalled();
});
