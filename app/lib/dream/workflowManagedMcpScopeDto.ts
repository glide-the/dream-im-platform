// [Input] Exact Workflow Run and source Thread selected by Dream server orchestration.
// [Output] Strict actor-owned managed MCP workspace scope.
// [Pos] Registry107 DTO; no actor, table, column, SQL or Runtime configuration selector.
// [Sync] 2026-09-15: define the immutable managed MCP workspace scope contract.
import { z } from "zod";

const id = z.string().min(1).max(255);

export const workflowManagedMcpScopeInputDto = z.strictObject({
  thread_id: id,
  workflow_run_id: z.string().regex(/^run_[0-9a-f]{32}$/),
});

export const workflowManagedMcpScopeOutputDto = z.strictObject({
  thread_id: id,
  workflow_run_id: z.string().regex(/^run_[0-9a-f]{32}$/),
  workspace_id: id,
});

export const workflowManagedMcpScopeOperationContracts = {
  "workflow-managed-mcp-scope.resolve": {
    kind: "read" as const,
    userScope: "dream:read",
    input: workflowManagedMcpScopeInputDto,
    output: workflowManagedMcpScopeOutputDto,
  },
};

export type WorkflowManagedMcpScopeInput = z.infer<typeof workflowManagedMcpScopeInputDto>;
export type WorkflowManagedMcpScopeOperation = keyof typeof workflowManagedMcpScopeOperationContracts;
