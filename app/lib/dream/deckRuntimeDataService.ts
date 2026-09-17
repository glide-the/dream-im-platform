// [Input] Verified OAuth or exact Thread entity actor, closed request and existing Admin UOW.
// [Output] Strict named runtime-data result; no extra connection, transaction or business execution.
// [Pos] Admin service composition; refs management and actor analysis never accept entity delegation.
// [Sync] 2026-09-15: keep scoped runtime reads/memory repair separate from Deck management permission.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { configuredDeckVoicePolicy, type DeckVoiceActor } from "./deckVoiceService";
import { DeckRuntimeDataRepository } from "./deckRuntimeDataRepository";
import * as dto from "./deckRuntimeDataDto";
export const deckRuntimeDataSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export async function runDeckRuntimeDataOperation(operation: dto.DeckRuntimeDataOperation, rawInput: unknown, actor: DeckVoiceActor, tx: DataTransaction, policy = configuredDeckVoicePolicy()) {
  const contract = dto.deckRuntimeDataOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const threadBound = operation === "deck-plugin-refs.runtime-read" || operation === "voice-memory.resolve";
  if (actor.threadScope !== null && (!threadBound || dto.threadDataInputDto.parse(parsed.data).thread_id !== actor.threadScope)) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  const store = new DeckRuntimeDataRepository(tx, principal.canonical_user_id, policy);
  let result: unknown;
  switch (operation) {
    case "deck-plugin-refs.list": result = await store.list(dto.deckRuntimeDataOperationContracts[operation].input.parse(parsed.data).deck_id); break;
    case "deck-plugin-refs.prepare": result = await store.prepare(dto.pluginRefsPrepareInputDto.parse(parsed.data)); break;
    case "deck-plugin-refs.runtime-read": result = await store.runtimeRead(dto.threadDataInputDto.parse(parsed.data).thread_id); break;
    case "deck-plugin-refs.replace": result = await store.replace(dto.pluginRefsReplaceInputDto.parse(parsed.data)); break;
    case "voice-analysis.list": result = await store.analysisVoices(); break;
    case "voice-memory.resolve": result = await store.memory(dto.threadDataInputDto.parse(parsed.data).thread_id); break;
  }
  return contract.output.parse(result);
}
