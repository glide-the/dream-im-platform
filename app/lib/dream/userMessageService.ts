// [Input] Verified OAuth/entity actor and one strict canonical user-turn command in an existing transaction.
// [Output] User message/title atomically saved or an authoritative pre-persisted confirmation retained.
// [Pos] Domain composition of reused Thread repository and confirmation guard; no second persistence path.
// [Sync] 2026-09-15: title algorithm remains Dream's pure message-parts projection; Admin owns atomic write.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { ChatThreadActor } from "./chatThreadService";
import { ChatThreadRepository } from "./chatThreadRepository";
import { guardPersistedDreamConfirmation } from "./confirmationGuard";
import { userMessageInputDto, userMessageOutputDto, type UserMessageInput } from "./userMessageDto";
import { chatAutoTitleCapacity } from "../../../config/dream-domain-policy";
import { stripPythonString } from "./deckPluginManifestDto";

export async function persistCanonicalUserMessage(tx: DataTransaction, actor: ChatThreadActor, rawInput: unknown) {
  const parsed = userMessageInputDto.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  const input: UserMessageInput = { ...parsed.data, metadata_json: parsed.data.metadata_json ?? null };
  if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null && actor.threadScope !== input.thread_id) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  const store = new ChatThreadRepository(tx, principal.canonical_user_id);
  await store.requireOwned(input.thread_id, true);
  if (await guardPersistedDreamConfirmation(tx, principal.canonical_user_id, input)) return userMessageOutputDto.parse({ message_id: input.message_id, confirmation_preserved: true });
  const title = [...stripPythonString(input.title_candidate)].slice(0, chatAutoTitleCapacity()).join("");
  const messageId = await store.persistUserMessageRaw(input, title);
  return userMessageOutputDto.parse({ message_id: messageId, confirmation_preserved: false });
}
