// [Input] Configured Dream service, OAuth or exact Thread/Run grant and Registry107 envelope.
// [Output] Strict managed MCP workspace scope from one capability-checked read UOW.
// [Pos] Thin Registry107 ingress; MCP loading, filesystem and Runtime remain in Dream.
// [Sync] 2026-09-15: bind both Thread and Run before invoking the typed service.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { workflowManagedMcpScopeOperationContracts, type WorkflowManagedMcpScopeOperation } from "./workflowManagedMcpScopeDto";
import { runWorkflowManagedMcpScopeOperation, workflowManagedMcpScopeSchemaRequirements } from "./workflowManagedMcpScopeService";

export function isWorkflowManagedMcpScopeOperation(name: string): name is WorkflowManagedMcpScopeOperation {
  return Object.hasOwn(workflowManagedMcpScopeOperationContracts, name);
}

export async function handleWorkflowManagedMcpScope(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isWorkflowManagedMcpScopeOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = workflowManagedMcpScopeOperationContracts[name];
    const envelope = await parseAuthDto(
      request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")),
    );
    setRequestId(envelope.request_id);
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    return withDataTransaction([
      identitySchemaRequirement,
      ...workflowManagedMcpScopeSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []),
    ], async tx => {
      const actor = await requireDataActor(
        tx,
        request.headers,
        service,
        operation.userScope,
        envelope.input.thread_id,
        envelope.input.workflow_run_id,
      );
      return runWorkflowManagedMcpScopeOperation(name, envelope.input, actor, tx);
    });
  });
}
