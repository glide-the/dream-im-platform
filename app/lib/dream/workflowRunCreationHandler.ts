// [Input] Configured service OAuth and one closed create/retry envelope without actor or frozen-state selectors.
// [Output] Exact capability-gated creation with the same live subject at each clean transaction boundary.
// [Pos] Thin creation ingress; no SQL, Runtime, Session or generic state patch crosses the request boundary.
// [Sync] 2026-09-15: repeat OAuth write authority before both retry prerequisite and atomic creation UOW.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { workflowRunCreationOperationContracts, type WorkflowRunCreationOperation } from "./workflowRunCreationDto";
import { WorkflowRunCreationService, workflowRunCreationSchemaRequirements } from "./workflowRunCreationService";
export { workflowRunCreationSchemaRequirements } from "./workflowRunCreationService";
export function isWorkflowRunCreationOperation(name: string): name is WorkflowRunCreationOperation {
  return Object.hasOwn(workflowRunCreationOperationContracts, name);
}
export async function handleWorkflowRunCreation(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isWorkflowRunCreationOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = workflowRunCreationOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const principal = await withDataTransaction(workflowRunCreationSchemaRequirements, tx => principalForServiceToken(tx, token, service, "dream:write"));
    const creation = new WorkflowRunCreationService(action => withDataTransaction(workflowRunCreationSchemaRequirements, async tx => {
      const current = await principalForServiceToken(tx, token, service, "dream:write");
      if (current.subject !== principal.subject || current.canonical_user_id !== principal.canonical_user_id || current.client_id !== principal.client_id) throw new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403);
      return action(tx);
    }));
    return creation.execute(name, service.id, principal, envelope.request_id, envelope.input);
  });
}
