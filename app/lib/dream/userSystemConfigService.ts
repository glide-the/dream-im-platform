// [Input] Verified OAuth actor, closed normalized command, existing UOW and mandatory pure codec DI.
// [Output] Exact Python JSON config or merged SystemConfig success without other preference changes.
// [Pos] Unregistered service; producer must wrap write/result/audit in one existing receipt UOW.
// [Sync] 2026-09-15: share mandatory raw-read with owned Thread consumer; user management stays OAuth-only.
import { AuthBoundaryError } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { UserSystemConfigRepository } from "./userSystemConfigRepository";
import * as dto from "./userSystemConfigDto";
export const userSystemConfigSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export type UserSystemConfigActor = { principal: PrincipalDto; threadScope: string | null; runScope: string | null; editorSessionScope: string | null };
export type UserSystemConfigCodec = (value: { action: "read" | "merge"; stored_json: string | null; patch?: dto.UserSystemConfigPatch }) => Promise<unknown>;
export function requireUserSystemConfigActor(actor: UserSystemConfigActor, scope: string) {
  const result = principalDto.safeParse(actor.principal);
  if (!result.success) throw new AuthBoundaryError("DREAM_PRINCIPAL_INVALID", 403);
  if (!result.data.scopes.includes(scope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null || actor.runScope !== null || actor.editorSessionScope !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  return result.data;
}
export async function readUserSystemConfig(tx: DataTransaction, canonicalUserId: string, codec: UserSystemConfigCodec) {
  if (typeof codec !== "function") throw new AuthBoundaryError("USER_SYSTEM_CONFIG_CODEC_UNAVAILABLE");
  const row = await new UserSystemConfigRepository(tx, canonicalUserId).get();
  const result = dto.userSystemConfigReadOutputDto.safeParse(await codec({ action: "read", stored_json: row?.system_config_json ?? null }));
  if (!result.success) throw new AuthBoundaryError("USER_SYSTEM_CONFIG_DATA_INVALID");
  return result.data;
}
export async function runUserSystemConfigOperation(operation: dto.UserSystemConfigOperation, rawInput: unknown,
  actor: UserSystemConfigActor, tx: DataTransaction, codec: UserSystemConfigCodec) {
  const contract = dto.userSystemConfigOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = requireUserSystemConfigActor(actor, contract.userScope);
  if (typeof codec !== "function") throw new AuthBoundaryError("USER_SYSTEM_CONFIG_CODEC_UNAVAILABLE");
  if (operation === "user-system-config.get") return readUserSystemConfig(tx, principal.canonical_user_id, codec);
  const store = new UserSystemConfigRepository(tx, principal.canonical_user_id);
  const patch = dto.userSystemConfigPatchDto.parse(input.data), row = await store.ensureLocked();
  const result = dto.userSystemConfigReadOutputDto.safeParse(await codec({ action: "merge", stored_json: row.system_config_json, patch }));
  if (!result.success) throw new AuthBoundaryError("USER_SYSTEM_CONFIG_DATA_INVALID");
  await store.update(result.data.config_json);
  return dto.userSystemConfigPatchOutputDto.parse({ success: true });
}
