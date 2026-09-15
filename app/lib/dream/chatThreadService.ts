// [Input] Strict named business DTO, Admin-verified principal/thread delegation and caller-owned UOW.
// [Output] Validated Thread/message DTO result; mutation and generic receipt commit in the same transaction.
// [Pos] Primary-owned Admin domain service, consumed by the provider operation handler.
// [Sync] 2026-09-14: preserve ownership/CAS/replay and consume the published 0033 unified capability digest.
import { AuthBoundaryError } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction, SchemaRequirement } from "./database";
import { ChatThreadRepository } from "./chatThreadRepository";
import * as dto from "./chatThreadDto";

// Published physical capabilities from immutable Admin 0033/0042/0043.
// 0033 supersedes the 0032 unified v1 digest without changing its version. API
// descriptor hashes are independently generated from each exact DTO pair.
export const dreamUnifiedSchemaRequirement: SchemaRequirement = { capability: "dream.schema.unified.v1", version: 1, contractSha256: "8b71cf5687f61dee884c3e6f2fb109c7a951b0789066a0f13583a7b67757fa71" };
export const chatThreadSchemaRequirements: readonly SchemaRequirement[] = [
  dreamUnifiedSchemaRequirement,
  { capability: "dream.chat-history-keyset-pagination.v1", version: 1, contractSha256: "a0dfe5f8d4b4330a9e17db07a8716d5d2bc25e291f3624f09005e79c01fc8ab0" },
  { capability: "dream.chat-history-final-projection.v1", version: 1, contractSha256: "50c27f86113c170064b0913bf052f9bd12884d3345c920d7b11468a768e0a432" },
];
export type ChatThreadActor = { principal: PrincipalDto; threadScope: string | null };
export function validateChatThreadActor(actor: ChatThreadActor, operation: dto.ChatThreadOperation, input: unknown) {
  const principal = principalDto.parse(actor.principal);
  const kind = dto.chatThreadOperationContracts[operation].kind;
  if (!principal.scopes.includes(kind === "read" ? "dream:read" : "dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null) {
    if (!input || typeof input !== "object" || !("thread_id" in input) || input.thread_id !== actor.threadScope) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
    if (["chat-thread.delete", "chat-thread.bind-deck", "chat-thread.select-voice"].includes(operation)) throw new AuthBoundaryError("DREAM_DELEGATION_SCOPE_REQUIRED", 403);
  }
  return principal;
}
export async function runChatThreadOperation(operation: dto.ChatThreadOperation, rawInput: unknown, actor: ChatThreadActor, transaction: DataTransaction) {
  const contract = dto.chatThreadOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("DREAM_OPERATION_NOT_FOUND", 404);
  const validated = contract.input.safeParse(rawInput);
  if (!validated.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = validateChatThreadActor(actor, operation, validated.data);
  const store = new ChatThreadRepository(transaction, principal.canonical_user_id);
  let output: unknown;
  switch (operation) {
    case "chat-thread.create": output = await store.create(dto.threadCreateInputDto.parse(validated.data)); break;
    case "chat-thread.get": output = { thread: await store.get(dto.threadIdInputDto.parse(validated.data).thread_id) }; break;
    case "chat-thread.list": output = { threads: await store.list(dto.threadListInputDto.parse(validated.data)) }; break;
    case "chat-thread.search": output = { threads: await store.search(dto.threadSearchInputDto.parse(validated.data).deck_id) }; break;
    case "chat-thread.delete": output = { changed: await store.delete(dto.threadIdInputDto.parse(validated.data).thread_id) }; break;
    case "chat-thread.bind-deck": { const v = dto.threadBindDeckInputDto.parse(validated.data); output = { changed: await store.bindDeck(v.thread_id, v.deck_id) }; break; }
    case "chat-thread.select-voice": output = { changed: await store.selectVoice(dto.threadSelectVoiceInputDto.parse(validated.data)) }; break;
    case "chat-thread.update-title": { const v = dto.threadTitleInputDto.parse(validated.data); output = { changed: await store.updateTitle(v.thread_id, v.title) }; break; }
    case "chat-thread.update-session": { const v = dto.threadSessionInputDto.parse(validated.data); output = { changed: await store.updateSession(v.thread_id, v.claude_session_id, v.agent_contract_version) }; break; }
    case "chat-message.persist": output = { message_id: await store.persistMessage(dto.messagePersistInputDto.parse(validated.data)) }; break;
    case "chat-message.list": output = { messages: await store.messages(dto.threadIdInputDto.parse(validated.data).thread_id) }; break;
    case "chat-message.page": output = await store.page(dto.messagePageInputDto.parse(validated.data)); break;
    case "chat-message.process-detail": { const v = dto.messageDetailInputDto.parse(validated.data); output = { message: await store.processDetail(v.thread_id, v.message_id) }; break; }
    case "chat-message.latest": output = { message_id: await store.latest(dto.threadIdInputDto.parse(validated.data).thread_id) }; break;
  }
  return contract.output.parse(output);
}
