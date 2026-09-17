// [Input] Registry107 DTO/service with fixed actor and Repository seam.
// [Output] Strict selector rejection, entity-grant checks and owner-scoped projection validation.
// [Pos] Provider-free managed MCP scope domain test.
// [Sync] 2026-09-15: cover the DTO-Service boundary without database or Runtime access.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("./workflowManagedMcpScopeRepository", () => ({
  WorkflowManagedMcpScopeRepository: class { resolve = mocks.resolve; },
}));

import { workflowManagedMcpScopeInputDto, workflowManagedMcpScopeOutputDto } from "./workflowManagedMcpScopeDto";
import { runWorkflowManagedMcpScopeOperation } from "./workflowManagedMcpScopeService";
import type { DataTransaction } from "./database";

const run = `run_${"a".repeat(32)}`;
const input = { thread_id: "thread-1", workflow_run_id: run };
const output = { ...input, workspace_id: "workspace-1" };
const actor = { principal: { subject: "subject", canonical_user_id: "42", client_id: "dream", scopes: ["dream:read"], status: "active" }, threadScope: "thread-1", runScope: run };
const tx = {} as DataTransaction;

beforeEach(() => { vi.resetAllMocks(); mocks.resolve.mockResolvedValue(output); });

it("accepts only the exact Run/Thread DTO and returns the bound scope", async () => {
  expect(await runWorkflowManagedMcpScopeOperation("workflow-managed-mcp-scope.resolve", input, actor, tx)).toEqual(output);
  expect(mocks.resolve).toHaveBeenCalledExactlyOnceWith(input);
  for (const key of ["actor_id", "user_id", "workspace_id", "table", "column", "sql", "runtime_node_id"])
    expect(workflowManagedMcpScopeInputDto.safeParse({ ...input, [key]: "caller" }).success).toBe(false);
  expect(workflowManagedMcpScopeOutputDto.safeParse({ ...output, database_url: "secret" }).success).toBe(false);
});

it("rejects mismatched delegated Thread or Run before ORM access", async () => {
  await expect(runWorkflowManagedMcpScopeOperation("workflow-managed-mcp-scope.resolve", input, { ...actor, threadScope: "other" }, tx)).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
  await expect(runWorkflowManagedMcpScopeOperation("workflow-managed-mcp-scope.resolve", input, { ...actor, runScope: `run_${"b".repeat(32)}` }, tx)).rejects.toMatchObject({ code: "DREAM_DELEGATION_ENTITY_DENIED", status: 403 });
  expect(mocks.resolve).not.toHaveBeenCalled();
});

it("fails closed for absent or inconsistent stored scope", async () => {
  mocks.resolve.mockResolvedValueOnce(null);
  await expect(runWorkflowManagedMcpScopeOperation("workflow-managed-mcp-scope.resolve", input, actor, tx)).rejects.toMatchObject({ code: "WORKFLOW_RUN_NOT_FOUND", status: 404 });
  mocks.resolve.mockResolvedValueOnce({ ...output, thread_id: "other" });
  await expect(runWorkflowManagedMcpScopeOperation("workflow-managed-mcp-scope.resolve", input, actor, tx)).rejects.toMatchObject({ code: "WORKFLOW_MANAGED_MCP_SCOPE_DATA_INVALID", status: 503 });
});
