// [Input] Strict Registry107 input, verified actor and caller-owned Admin UOW.
// [Output] Validated owner-filtered managed MCP workspace scope.
// [Pos] DTO-Service-ORM composition; Dream retains MCP snapshot use and Runtime behavior.
// [Sync] 2026-09-15: enforce OAuth/delegated Thread and Run boundaries before ORM access.
import { AuthBoundaryError } from "../auth/config";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { dreamUnifiedSchemaRequirement } from "./chatThreadService";
import { WorkflowManagedMcpScopeRepository } from "./workflowManagedMcpScopeRepository";
import * as dto from "./workflowManagedMcpScopeDto";

export const workflowManagedMcpScopeSchemaRequirements = [dreamUnifiedSchemaRequirement] as const;
export type WorkflowManagedMcpScopeActor = {
  principal: unknown;
  threadScope: string | null;
  runScope: string | null;
};

export async function runWorkflowManagedMcpScopeOperation(
  operation: dto.WorkflowManagedMcpScopeOperation,
  rawInput: unknown,
  actor: WorkflowManagedMcpScopeActor,
  tx: DataTransaction,
) {
  const contract = dto.workflowManagedMcpScopeOperationContracts[operation];
  if (!contract) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
  const parsed = contract.input.safeParse(rawInput);
  if (!parsed.success) throw new AuthBoundaryError("INPUT_INVALID", 400);
  const principal = principalDto.parse(actor.principal);
  if (!principal.scopes.includes(contract.userScope)) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  if (actor.threadScope !== null && actor.threadScope !== parsed.data.thread_id) {
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  }
  if (actor.runScope !== null && actor.runScope !== parsed.data.workflow_run_id) {
    throw new AuthBoundaryError("DREAM_DELEGATION_ENTITY_DENIED", 403);
  }
  const result = await new WorkflowManagedMcpScopeRepository(
    tx,
    principal.canonical_user_id,
  ).resolve(parsed.data);
  if (result === null) throw new AuthBoundaryError("WORKFLOW_RUN_NOT_FOUND", 404);
  const output = contract.output.safeParse(result);
  if (!output.success || output.data.thread_id !== parsed.data.thread_id
    || output.data.workflow_run_id !== parsed.data.workflow_run_id) {
    throw new AuthBoundaryError("WORKFLOW_MANAGED_MCP_SCOPE_DATA_INVALID");
  }
  return output.data;
}
