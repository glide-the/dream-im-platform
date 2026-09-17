// [Input] Strict Thread/profile request, verified actor, caller UOW and server-owned adapter configuration.
// [Output] Validated Registry106 storage projection without artifact, filesystem or Runtime execution.
// [Pos] Workspace plugin data orchestration; Handler owns authentication and UOW acquisition.
// [Sync] 2026-09-15: parse adapter policy only for Story Workspace and fail closed through explicit facts.
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { DeckVoiceActor } from "./deckVoiceService";
import { deckRuntimeDataSchemaRequirements } from "./deckRuntimeDataService";
import { DeckWorkspacePluginsRepository } from "./deckWorkspacePluginsRepository";
import * as dto from "./deckWorkspacePluginsDto";

export const deckWorkspacePluginsSchemaRequirements = deckRuntimeDataSchemaRequirements;

export function configuredDeckWorkspacePluginPolicy() {
  let raw: unknown;
  try {
    raw = JSON.parse(requiredAuthValue("DREAM_WORKSPACE_PLUGIN_POLICY_JSON"));
  } catch {
    throw new AuthBoundaryError("WORKSPACE_PLUGIN_POLICY_NOT_CONFIGURED");
  }
  const parsed = dto.deckWorkspacePluginPolicyDto.safeParse(raw);
  if (!parsed.success) throw new AuthBoundaryError("WORKSPACE_PLUGIN_POLICY_NOT_CONFIGURED");
  return parsed.data;
}

export async function runDeckWorkspacePluginsOperation(
  operation: dto.DeckWorkspacePluginsOperation,
  rawInput: unknown,
  actor: DeckVoiceActor,
  tx: DataTransaction,
  suppliedPolicy?: dto.DeckWorkspacePluginPolicy,
) {
  const contract = dto.deckWorkspacePluginsOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null && actor.threadScope !== input.data.thread_id) {
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  }
  const adapterPolicy = input.data.profile === "story_workspace"
    ? suppliedPolicy ?? configuredDeckWorkspacePluginPolicy()
    : null;
  const result = await new DeckWorkspacePluginsRepository(
    tx,
    principal.canonical_user_id,
  ).resolve(input.data, adapterPolicy);
  const output = contract.output.safeParse(result);
  if (!output.success) throw new AuthBoundaryError("DECK_WORKSPACE_PLUGIN_DATA_INVALID");
  const refIds = output.data.refs.map(ref => ref.plugin_installation_id);
  if (
    output.data.thread_id !== input.data.thread_id
    || refIds.length !== new Set(refIds).size
    || output.data.refs.some((ref, index, refs) => (
      index > 0 && refs[index - 1]!.order_index > ref.order_index
    ))
    || (output.data.deck_id === null && (
      output.data.refs.length > 0 || output.data.story_workspace_adapter !== null
    ))
    || (input.data.profile === "standard" && output.data.story_workspace_adapter !== null)
    || output.data.story_workspace_adapter?.ready?.installation_status !== undefined
      && output.data.story_workspace_adapter.ready.installation_status !== "ready"
  ) {
    throw new AuthBoundaryError("DECK_WORKSPACE_PLUGIN_DATA_INVALID");
  }
  return output.data;
}
