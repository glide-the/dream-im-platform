// [Input] Strict empty request, verified OAuth actor, Admin data UOW and optional validated Deck policy.
// [Output] One closed configured ready candidate or null without local artifact/CLI verification.
// [Pos] Registry104 service boundary; existing Deck writes retain independent evidence rechecks.
// [Sync] 2026-09-15: require dream:read, reject entity grants and fail closed on malformed stored projection.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { DeckVoiceActor } from "./deckVoiceService";
import { configuredDeckVoicePolicy, deckVoiceSchemaRequirements } from "./deckVoiceService";
import type { DeckVoicePolicyDto } from "./deckVoiceDto";
import * as dto from "./deckDefaultPluginResolveDto";
import { DeckDefaultPluginResolveRepository } from "./deckDefaultPluginResolveRepository";

export const deckDefaultPluginResolveSchemaRequirements = deckVoiceSchemaRequirements;

export async function runDeckDefaultPluginResolveOperation(
  operation: dto.DeckDefaultPluginResolveOperation,
  rawInput: unknown,
  actor: DeckVoiceActor,
  tx: DataTransaction,
  suppliedPolicy?: DeckVoicePolicyDto,
) {
  const contract = dto.deckDefaultPluginResolveOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  const policy = suppliedPolicy ?? configuredDeckVoicePolicy();
  const result = { installation: await new DeckDefaultPluginResolveRepository(tx).resolve(policy) };
  const output = contract.output.safeParse(result);
  if (!output.success) throw new AuthBoundaryError("DEFAULT_DECK_PLUGIN_DATA_INVALID");
  return output.data;
}
