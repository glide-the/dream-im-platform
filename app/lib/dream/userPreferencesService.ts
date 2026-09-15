// [Input] Verified OAuth user actor, closed named preference request and existing Admin UOW.
// [Output] Validated original config projection or atomic merge result; entity grants cannot manage preferences.
// [Pos] User preference orchestration; receipt/audit transaction remains the thin Handler's responsibility.
// [Sync] 2026-09-15: preserve raw config objects, NULL merge and original offset/microsecond projection.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { ChatThreadActor } from "./chatThreadService";
import type { DataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { inspectMemoryConfig } from "./deckContentCanonical";
import { pgTimestampToIso } from "./chatThreadDto";
import { UserPreferencesRepository } from "./userPreferencesRepository";
import * as dto from "./userPreferencesDto";
export const userPreferencesSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
async function requireConfigObject(raw: string | null, stored = false) {
  if (raw !== null && !(await inspectMemoryConfig(raw)).is_object) throw new AuthBoundaryError(stored ? "USER_PREFERENCES_DATA_INVALID" : "INPUT_INVALID", stored ? 503 : 400);
}
export async function runUserPreferencesOperation(operation: dto.UserPreferencesOperation, rawInput: unknown, actor: ChatThreadActor, tx: DataTransaction) {
  const contract = dto.userPreferencesOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  const store = new UserPreferencesRepository(tx, principal.canonical_user_id);
  if (operation === "user-preferences.save") {
    const merge = dto.userPreferencesSaveInputDto.parse(input.data);
    await requireConfigObject(merge.voice_configs_json); await requireConfigObject(merge.state_config_json);
    await store.save(merge); return contract.output.parse({ success: true });
  }
  const row = await store.get();
  if (!row) return contract.output.parse({ preferences: null });
  const voice = row.voice_configs_json || null, state = row.state_config_json || null;
  await requireConfigObject(voice, true); await requireConfigObject(state, true);
  const result = dto.userPreferencesDto.safeParse({ ...row, voice_configs_json: voice, state_config_json: state, updated_at: pgTimestampToIso(row.updated_at) });
  if (!result.success) throw new AuthBoundaryError("USER_PREFERENCES_DATA_INVALID");
  return contract.output.parse({ preferences: result.data });
}
