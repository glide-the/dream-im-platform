// [Input] Configured Dream service, OAuth or exact Thread/Run grant and Registry108 envelope.
// [Output] One capability-gated atomic Runtime activation result with original receipt identity.
// [Pos] Thin Registry108 ingress; workspace bytes, Agent Runtime, filesystem and SSE remain in Dream.
// [Sync] 2026-09-15: bind Thread/Run delegation before the DTO-Service-ORM activation UOW.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { workflowRuntimeActivationOperationContracts, type WorkflowRuntimeActivationOperation } from "./workflowRuntimeActivationDto";
import { runWorkflowRuntimeActivationOperation, workflowRuntimeActivationSchemaRequirements } from "./workflowRuntimeActivationService";

export function isWorkflowRuntimeActivationOperation(name: string): name is WorkflowRuntimeActivationOperation {
  return Object.hasOwn(workflowRuntimeActivationOperationContracts, name);
}

export async function handleWorkflowRuntimeActivation(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isWorkflowRuntimeActivationOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = workflowRuntimeActivationOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    return withDataTransaction([identitySchemaRequirement, ...workflowRuntimeActivationSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      const actor = await requireDataActor(tx, request.headers, service, operation.userScope,
        envelope.input.thread_id, envelope.input.workflow_run_id);
      return runWorkflowRuntimeActivationOperation(name, envelope.input, actor, service.id, envelope.request_id, tx);
    });
  });
}
