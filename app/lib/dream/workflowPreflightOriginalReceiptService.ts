// [Input] Verified OAuth subject/service and original request ID, without input/actor/workspace selectors.
// [Output] Durable absent/in-progress/committed evidence and only the exact bounded original response.
// [Pos] Admin read-only unknown-commit recovery; checking evidence never resumes or rolls back stages.
// [Sync] 2026-09-15: repeat workspace/canonical bindings and decrypt only committed original receipts.
import { AuthBoundaryError } from "../auth/config";
import { principalDto, requestIdDto, type PrincipalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { findOriginalPreflightRequest, lockOriginalPreflightRequest, preflightExecuteOperation, WorkflowPreflightExecutionRepository, type PreflightRequestContext } from "./workflowPreflightExecutionRepository";
import { projectPreflightExecutionRow } from "./workflowPreflightExecutionService";
import { workflowPreflightOriginalReceiptDto } from "./workflowPreflightExecutionDto";
import { WorkflowPreflightSecretReceipt } from "./workflowPreflightSecretReceipt";
export async function readOriginalPreflightReceipt(tx: DataTransaction, serviceClientId: string, rawPrincipal: PrincipalDto, rawRequestId: string) {
  const principal = principalDto.parse(rawPrincipal), requestId = requestIdDto.parse(rawRequestId);
  if (!principal.scopes.includes("dream:write")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const cipher = new WorkflowPreflightSecretReceipt();
  await lockOriginalPreflightRequest(tx, serviceClientId, principal.subject, requestId);
  const association = await findOriginalPreflightRequest(tx, serviceClientId, principal.subject, requestId);
  const receipts = new ReceiptRepository(tx, serviceClientId, principal.subject);
  if (!association) {
    if (await receipts.find(preflightExecuteOperation, requestId)) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE");
    return workflowPreflightOriginalReceiptDto.parse({ status: "absent", operation: preflightExecuteOperation, request_id: requestId });
  }
  if (association.canonicalUserId !== BigInt(principal.canonical_user_id)) throw new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403);
  const context: PreflightRequestContext = { serviceClientId, actor: principal.subject, canonicalUserId: principal.canonical_user_id, requestId,
    inputSha256: association.inputSha256, input: { workspace_id: association.workspaceId } };
  const repo = new WorkflowPreflightExecutionRepository(tx, context);
  // The original association is immutable. Its digest lock prevents a final
  // status/receipt commit between the two queries below.
  await repo.assertWorkspace();
  const receipt = await receipts.find(preflightExecuteOperation, requestId);
  if (receipt) {
    if (receipt.inputSha256 !== association.inputSha256 || receipt.threadScope !== null || receipt.editorSessionScope !== null || receipt.runScope !== null) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE");
    const result = cipher.recover({ service_client_id: serviceClientId, actor: principal.subject, operation: preflightExecuteOperation,
      request_id: requestId, input_sha256: association.inputSha256, workflow_preflight_id: association.workflowPreflightId,
      canonical_user_id: principal.canonical_user_id, workspace_id: association.workspaceId }, receipt.result);
    return workflowPreflightOriginalReceiptDto.parse({ status: "committed", operation: preflightExecuteOperation, request_id: requestId, result });
  }
  const row = await repo.read(association.workflowPreflightId);
  if (!association.executionOwner || row.status !== "checking") throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_RECEIPT_UNAVAILABLE");
  return workflowPreflightOriginalReceiptDto.parse({ status: "in_progress", operation: preflightExecuteOperation, request_id: requestId,
    result: { request_state: "in_progress", preflight: projectPreflightExecutionRow(row) } });
}
