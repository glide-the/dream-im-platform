// [Input] Upstream verified OAuth/persistence actor, exact Thread selector and existing short UOW.
// [Output] Current owner-checked raw user config; mandatory codec failures never default to empty.
// [Pos] Unregistered read candidate; reuse Thread/UserConfig Repository and proven pure codec.
// [Sync] 2026-09-15: current Thread ownership precedes config read without upgrading upstream grant locks.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ChatThreadRepository } from "./chatThreadRepository";
import { userSystemConfigSchemaRequirements, readUserSystemConfig, type UserSystemConfigActor, type UserSystemConfigCodec } from "./userSystemConfigService";
import * as dto from "./threadSystemConfigDto";
export const threadSystemConfigSchemaRequirements = userSystemConfigSchemaRequirements;
export type ThreadSystemConfigActor = UserSystemConfigActor;
export async function runThreadSystemConfigOperation(operation: dto.ThreadSystemConfigOperation, rawInput: unknown,
  actor: ThreadSystemConfigActor, tx: DataTransaction, codec: UserSystemConfigCodec) {
  const contract = dto.threadSystemConfigOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.safeParse(actor.principal);
  if (!principal.success) throw new AuthBoundaryError("DREAM_PRINCIPAL_INVALID", 403);
  if (!principal.data.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.editorSessionScope !== null || (actor.threadScope === null && actor.runScope !== null) ||
      (actor.threadScope !== null && actor.threadScope !== input.data.thread_id)) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  if (typeof codec !== "function") throw new AuthBoundaryError("USER_SYSTEM_CONFIG_CODEC_UNAVAILABLE");
  await new ChatThreadRepository(tx, principal.data.canonical_user_id).requireOwned(input.data.thread_id);
  return readUserSystemConfig(tx, principal.data.canonical_user_id, codec);
}
