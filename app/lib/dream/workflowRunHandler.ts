// [Input] Configured service, OAuth or exact existing Run grant and a closed named lookup envelope.
// [Output] Owner-scoped Run/history DTO from the capability-gated Admin PostgreSQL transaction.
// [Pos] Thin Workflow ingress; stored grants cannot select another Run or acquire activation rights.
// [Sync] 2026-09-15: register reads independently of not-yet-implemented Workflow state commands.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { workflowRunOperationContracts, type WorkflowRunOperation } from "./workflowRunDto";
import { readWorkflowRun } from "./workflowRunService";

export function isWorkflowRunOperation(name: string): name is WorkflowRunOperation { return Object.hasOwn(workflowRunOperationContracts, name); }
export async function handleWorkflowRun(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isWorkflowRunOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = workflowRunOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    return withDataTransaction([identitySchemaRequirement, dreamUnifiedSchemaRequirement, ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      const actor = await requireDataActor(tx, request.headers, service, "dream:read", undefined, envelope.input.workflow_run_id);
      return readWorkflowRun(name, envelope.input, actor, tx);
    });
  });
}
