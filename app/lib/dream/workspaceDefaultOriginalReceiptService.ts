// [Input] Original request/name and verified live OAuth write subject without entity selectors.
// [Output] Absent or complete original default Workspace text ID after current-owner validation.
// [Pos] Fixed default Workspace recovery; no creation, SQL mutation or original input override.
// [Sync] 2026-09-15: enforce empty input digest, all null scopes and current canonical ownership.
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { principalDto, requestIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository, operationInputDigest } from "./receipts";
import { requireOwnedWorkspaceDefaultResult, requireWorkspaceDefaultActor } from "./workspaceDefaultService";
export async function readOriginalWorkspaceDefaultReceipt(tx: DataTransaction, serviceId: string, rawPrincipal: z.output<typeof principalDto>, name: string, rawRequestId: string) {
  if (name !== "workspace-default.ensure") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const principal = requireWorkspaceDefaultActor({ principal: rawPrincipal, threadScope: null, runScope: null, editorSessionScope: null });
  const requestId = requestIdDto.parse(rawRequestId), prior = await new ReceiptRepository(tx, serviceId, principal.subject).find(name, requestId);
  if (!prior) return { status: "absent" as const, operation: name, request_id: requestId };
  if (prior.inputSha256 !== operationInputDigest({}) || prior.threadScope !== null || prior.editorSessionScope !== null || prior.runScope !== null)
    throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
  const result = await requireOwnedWorkspaceDefaultResult(tx, principal.canonical_user_id, prior.result);
  return { status: "committed" as const, operation: name, request_id: requestId, result };
}
