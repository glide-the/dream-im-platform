// [Input] Original name/request and verified OAuth write principal, with no business selectors.
// [Output] Absent or full historical completion after current owner/source and immutable-input checks.
// [Pos] Registered77 fixed failure recovery; no metadata overlay or Runtime authority.
// [Sync] 2026-09-15: wire original owned workspace/error/input-digest recovery unchanged.
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { principalDto, requestIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository, operationInputDigest } from "./receipts";
import { DreamLaunchFailureRepository } from "./dreamLaunchFailureRepository";
import { dreamLaunchFailureEnvelopeInputDto, dreamLaunchFailureEnvelopeOutputDto } from "./dreamLaunchFailureDto";
import { loadDreamLaunchFailureFacts, validateDreamLaunchFailureResult } from "./dreamLaunchFailureService";
export async function readOriginalDreamLaunchFailureReceipt(tx: DataTransaction, serviceId: string, rawPrincipal: z.output<typeof principalDto>, name: string, rawRequestId: string) {
  if (name !== "dream-launch-failure.envelope") throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const principal = principalDto.parse(rawPrincipal), requestId = requestIdDto.parse(rawRequestId);
  if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const prior = await new ReceiptRepository(tx, serviceId, principal.subject).find(name, requestId);
  if (!prior) return { status: "absent" as const, operation: name, request_id: requestId };
  const parsed = dreamLaunchFailureEnvelopeOutputDto.safeParse(prior.result);
  if (!parsed.success) throw new AuthBoundaryError("DREAM_LAUNCH_FAILURE_RECEIPT_INVALID");
  const result = parsed.data;
  if (prior.threadScope !== result.thread_id || prior.editorSessionScope !== null || prior.runScope !== result.workflow_run_id)
    throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
  const workspaceId = await new DreamLaunchFailureRepository(tx).ownedWorkspace(principal.canonical_user_id, result.workflow_run_id);
  if (!workspaceId) throw new AuthBoundaryError("DREAM_LAUNCH_FAILURE_PERMISSION_DENIED", 403);
  const input = dreamLaunchFailureEnvelopeInputDto.parse({ workspace_id: workspaceId, workflow_run_id: result.workflow_run_id, error_code: result.error_code });
  if (prior.inputSha256 !== operationInputDigest(input)) throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
  const facts = await loadDreamLaunchFailureFacts(input, { principal, threadScope: null, runScope: null }, tx);
  validateDreamLaunchFailureResult(result, facts);
  return { status: "committed" as const, operation: name, request_id: requestId, result };
}
