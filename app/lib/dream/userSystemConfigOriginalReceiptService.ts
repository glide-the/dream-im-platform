// [Input] Original patch operation/request and live OAuth owner in the exact Admin data UOW.
// [Output] Absent or full immutable original success result with null entity scopes.
// [Pos] Bounded patch recovery; current config/defaults/Runtime are never read or reapplied.
// [Sync] 2026-09-15: validate stored digest/result without reconstructing a later configuration.
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { principalDto, requestIdDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { userSystemConfigPatchOutputDto } from "./userSystemConfigDto";
const inputDigestDto = z.string().regex(/^[0-9a-f]{64}$/);
export async function readOriginalUserSystemConfigReceipt(tx: DataTransaction, serviceId: string,
  rawPrincipal: PrincipalDto, name: string, rawRequestId: string) {
  if (name !== "user-system-config.patch") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const principal = principalDto.safeParse(rawPrincipal);
  if (!principal.success) throw new AuthBoundaryError("DREAM_PRINCIPAL_INVALID", 403);
  if (!principal.data.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const requestId = requestIdDto.safeParse(rawRequestId);
  if (!requestId.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const prior = await new ReceiptRepository(tx, serviceId, principal.data.subject).find(name, requestId.data);
  if (!prior) return { status: "absent" as const, operation: name, request_id: requestId.data };
  if (!inputDigestDto.safeParse(prior.inputSha256).success || prior.threadScope !== null || prior.editorSessionScope !== null || prior.runScope !== null)
    throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
  const result = userSystemConfigPatchOutputDto.safeParse(prior.result);
  if (!result.success) throw new AuthBoundaryError("USER_SYSTEM_CONFIG_RECEIPT_INVALID");
  return { status: "committed" as const, operation: name, request_id: requestId.data, result: result.data };
}
