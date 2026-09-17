// [Input] Configured service, verified OAuth/existing persistence grant and one closed lifecycle envelope.
// [Output] Atomic Run/Session/history/result/audit with exact original Run/Thread receipt recovery.
// [Pos] Thin named lifecycle ingress; start requires OAuth activation authority.
// [Sync] 2026-09-15: never accept client readiness booleans or turn a persistence bearer into activation rights.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { workflowRunCommandOperationContracts, type WorkflowRunCommandOperation } from "./workflowRunCommandDto";
import { prepareWorkflowRunCommand, workflowRunCommandSchemaRequirements } from "./workflowRunCommandService";
import { ReceiptRepository } from "./receipts";

export function isWorkflowRunCommandOperation(name: string): name is WorkflowRunCommandOperation { return Object.hasOwn(workflowRunCommandOperationContracts, name); }
export async function handleWorkflowRunCommand(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isWorkflowRunCommandOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = workflowRunCommandOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    if (name === "workflow-run.start" && delegated) throw new AuthBoundaryError("DELEGATION_ACTIVATION_DENIED", 403);
    return withDataTransaction([...workflowRunCommandSchemaRequirements(name), ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      const actor = await requireDataActor(tx, request.headers, service, "dream:write", undefined, envelope.input.workflow_run_id);
      const prepared = await prepareWorkflowRunCommand(name, envelope.input, actor, tx);
      return new ReceiptRepository(tx, service.id, actor.principal.subject).execute(name, envelope.request_id, envelope.input, operation.output, prepared.action, prepared.threadScope, null, prepared.runScope);
    });
  });
}
