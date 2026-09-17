// [Input] Registry107 Repository with captured typed Drizzle query results.
// [Output] Narrow Run/Thread/workspace projection and absent-row behavior.
// [Pos] Provider-free ORM test; no PostgreSQL connection or generic SQL surface.
// [Sync] 2026-09-15: prove one owner-filtered joined query.
import { expect, it } from "vitest";
import { WorkflowManagedMcpScopeRepository } from "./workflowManagedMcpScopeRepository";
import type { DataTransaction } from "./database";

const run = `run_${"a".repeat(32)}`;
const input = { thread_id: "thread-1", workflow_run_id: run };

function captured(rows: Array<Record<string, unknown>>) {
  const calls = { joins: 0, limits: [] as number[] };
  const tx = { select() { const chain = {
    from() { return chain; }, innerJoin() { calls.joins += 1; return chain; }, where() { return chain; },
    async limit(value: number) { calls.limits.push(value); return rows; },
  }; return chain; } } as unknown as DataTransaction;
  return { tx, calls };
}

it("returns only the canonical managed MCP scope through one typed join", async () => {
  const output = { ...input, workspace_id: "workspace-1" };
  const { tx, calls } = captured([output]);
  expect(await new WorkflowManagedMcpScopeRepository(tx, "42").resolve(input)).toEqual(output);
  expect(calls).toEqual({ joins: 1, limits: [1] });
});

it("returns null when the owner/run/thread/workspace join has no row", async () => {
  const { tx } = captured([]);
  expect(await new WorkflowManagedMcpScopeRepository(tx, "42").resolve(input)).toBeNull();
});
