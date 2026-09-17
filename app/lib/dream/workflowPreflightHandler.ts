// [Input] Configured service, bound OAuth and a closed Preflight read envelope without actor selectors.
// [Output] Strict owned Preflight from the exact capability-gated Admin data transaction.
// [Pos] Thin token-bearing read ingress; entity persistence grants cannot acquire Run creation authority.
// [Sync] 2026-09-15: compose staged execute with exact capabilities and live OAuth checks; registration follows verification.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, workflowPreflightExecutionSchemaRequirements } from "./schemaRequirements";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { workflowPreflightReadInputDto } from "./workflowPreflightDto";
import { readWorkflowPreflight } from "./workflowPreflightService";
import { workflowPreflightExecutionInputDto } from "./workflowPreflightExecutionDto";
import { WorkflowPreflightExecutionService } from "./workflowPreflightExecutionService";
export { workflowPreflightExecutionSchemaRequirements } from "./schemaRequirements";
export async function handleWorkflowPreflightRead(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: workflowPreflightReadInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, dreamUnifiedSchemaRequirement], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, "dream:read");
      return readWorkflowPreflight(tx, envelope.input, principal);
    });
  });
}
export async function handleWorkflowPreflightExecute(request: Request) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: workflowPreflightExecutionInputDto }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const principal = await withDataTransaction(workflowPreflightExecutionSchemaRequirements, tx => principalForServiceToken(tx, token, service, "dream:write"));
    const execution = new WorkflowPreflightExecutionService(action => withDataTransaction(workflowPreflightExecutionSchemaRequirements, async tx => {
      const current = await principalForServiceToken(tx, token, service, "dream:write");
      if (current.subject !== principal.subject || current.canonical_user_id !== principal.canonical_user_id || current.client_id !== principal.client_id) throw new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403);
      return action(tx);
    }));
    return execution.execute(service.id, principal, envelope.request_id, envelope.input);
  });
}
