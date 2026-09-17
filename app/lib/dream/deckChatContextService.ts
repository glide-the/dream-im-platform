// [Input] Strict Deck/nullable Voice request, verified OAuth actor and existing Admin data UOW.
// [Output] Validated storage projection without Dream enabled/ready policy, prompt or Runtime behavior.
// [Pos] Registry105 data read orchestration; Handler owns authentication and UOW acquisition.
// [Sync] 2026-09-15: retain access/capability checks while Dream owns domain decisions.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DeckVoiceActor } from "./deckVoiceService";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import type { DataTransaction } from "./database";
import * as dto from "./deckChatContextDto";
import { DeckChatContextRepository } from "./deckChatContextRepository";

export const deckChatContextSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;

export async function runDeckChatContextOperation(
  operation: dto.DeckChatContextOperation,
  rawInput: unknown,
  actor: DeckVoiceActor,
  tx: DataTransaction,
) {
  const contract = dto.deckChatContextOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  const result = await new DeckChatContextRepository(tx, principal.canonical_user_id).resolve(input.data);
  const output = contract.output.safeParse(result);
  if (!output.success) throw new AuthBoundaryError("DECK_CHAT_CONTEXT_DATA_INVALID");
  return output.data;
}
