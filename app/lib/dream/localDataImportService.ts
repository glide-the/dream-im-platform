// [Input] Verified OAuth actor, one closed Registry101 command and the existing Admin data UOW.
// [Output] Validated import counts or the stable persisted first-login completion state.
// [Pos] Local-data business orchestration between strict DTOs and the typed repository.
// [Sync] 2026-09-15: keep all four import categories atomic and forbid delegated entity authority.
import { AuthBoundaryError } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { localDataImportOperationContracts, type LocalDataImportOperation } from "./localDataImportDto";
import { LocalDataImportRepository } from "./localDataImportRepository";

export const localDataImportSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export type LocalDataImportActor = {
  principal: PrincipalDto;
  threadScope: string | null;
  editorSessionScope: string | null;
  runScope: string | null;
};

export function requireLocalDataImportActor(actor: LocalDataImportActor, scope: string) {
  const principal = principalDto.safeParse(actor.principal);
  if (!principal.success) throw new AuthBoundaryError("DREAM_PRINCIPAL_INVALID", 403);
  if (!principal.data.scopes.includes(scope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null || actor.editorSessionScope !== null || actor.runScope !== null) throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  return principal.data;
}

export async function runLocalDataImportOperation(name: LocalDataImportOperation, rawInput: unknown, actor: LocalDataImportActor, tx: DataTransaction) {
  const operation = localDataImportOperationContracts[name];
  if (!operation) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const input = operation.input.safeParse(rawInput);
  if (!input.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = requireLocalDataImportActor(actor, operation.userScope);
  const repository = new LocalDataImportRepository(tx, principal.canonical_user_id);
  if (name === "local-data.import") {
    const imported = await repository.importData(localDataImportOperationContracts[name].input.parse(input.data));
    return localDataImportOperationContracts[name].output.parse({ success: true, imported });
  }
  const completed = await repository.completeFirstLogin();
  return localDataImportOperationContracts[name].output.parse({ success: true, first_login_completed: completed });
}
