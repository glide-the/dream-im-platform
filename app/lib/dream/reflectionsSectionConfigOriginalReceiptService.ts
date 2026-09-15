// [Input] Original write operation/request and live OAuth owner in the exact Admin data UOW.
// [Output] Absent or full original save/delete completion with null entity scopes.
// [Pos] Registered account-config recovery; current prompts/defaults/FS are never reapplied.
// [Sync] 2026-09-15: expose bounded write recovery without original-body selectors.
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { principalDto, requestIdDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { reflectionsSectionConfigOperationContracts as contracts, type ReflectionsSectionConfigOperation } from "./reflectionsSectionConfigDto";

type WriteOperation = Exclude<ReflectionsSectionConfigOperation, "reflections-section-config.get">;
const storedInputDigestDto = z.string().regex(/^[0-9a-f]{64}$/);

export function isReflectionsSectionConfigReceiptOperation(name: string): name is WriteOperation {
  return name === "reflections-section-config.save" || name === "reflections-section-config.delete";
}

export async function readOriginalReflectionsSectionConfigReceipt(
  tx: DataTransaction, serviceId: string, rawPrincipal: PrincipalDto, name: string, rawRequestId: string,
) {
  if (!isReflectionsSectionConfigReceiptOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const principal = principalDto.safeParse(rawPrincipal);
  if (!principal.success) throw new AuthBoundaryError("DREAM_PRINCIPAL_INVALID", 403);
  if (!principal.data.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const requestId = requestIdDto.safeParse(rawRequestId);
  if (!requestId.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const prior = await new ReceiptRepository(tx, serviceId, principal.data.subject).find(name, requestId.data);
  if (!prior) return { status: "absent" as const, operation: name, request_id: requestId.data };
  if (!storedInputDigestDto.safeParse(prior.inputSha256).success || prior.threadScope !== null ||
    prior.editorSessionScope !== null || prior.runScope !== null) {
    throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
  }
  const result = contracts[name].output.safeParse(prior.result);
  if (!result.success) throw new AuthBoundaryError("REFLECTIONS_SECTION_CONFIG_RECEIPT_INVALID");
  // The original bounded result has no prompt body. Input equality remains the POST receipt boundary;
  // recovery must not reconstruct that input from a configuration that may have changed since commit.
  return { status: "committed" as const, operation: name, request_id: requestId.data, result: result.data };
}
