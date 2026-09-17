// [Input] Verified OAuth actor, one closed Registry103 picture read and the existing Admin data UOW.
// [Output] Strict current-owner history projection without entity delegation or friendship authorization.
// [Pos] Picture-history orchestration; the thin Handler owns auth and UOW acquisition.
// [Sync] 2026-09-15: enforce dream:read and route both current-user reads through one typed repository.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { ChatThreadActor } from "./chatThreadService";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import type { DataTransaction } from "./database";
import * as dto from "./pictureHistoryDto";
import { PictureHistoryRepository } from "./pictureHistoryRepository";

export const pictureHistorySchemaRequirements = [dreamUnifiedSchemaRequirement] as const;

export async function runPictureHistoryOperation(
  operation: dto.PictureHistoryOperation,
  rawInput: unknown,
  actor: ChatThreadActor,
  tx: DataTransaction,
) {
  const contract = dto.pictureHistoryOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = contract.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  const repository = new PictureHistoryRepository(tx, principal.canonical_user_id);
  const result = operation === "picture-history.list"
    ? await repository.list(dto.pictureHistoryListInputDto.parse(input.data))
    : await repository.full(dto.pictureHistoryFullInputDto.parse(input.data).date);
  const output = contract.output.safeParse(result);
  if (!output.success) throw new AuthBoundaryError("PICTURE_HISTORY_DATA_INVALID");
  return output.data;
}
