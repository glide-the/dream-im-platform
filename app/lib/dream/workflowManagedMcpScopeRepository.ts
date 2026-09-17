// [Input] Canonical actor and strict Run/Thread identity in a caller-owned Admin UOW.
// [Output] Owner-filtered Workflow workspace projection through typed Drizzle ORM.
// [Pos] Registry107 Repository; no independent connection, transaction or caller-selected query.
// [Sync] 2026-09-15: resolve the managed MCP workspace from authoritative Run ownership.
import { and, eq, sql } from "drizzle-orm";
import { workflow_runs as runs } from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { WorkflowManagedMcpScopeInput } from "./workflowManagedMcpScopeDto";

export class WorkflowManagedMcpScopeRepository {
  constructor(
    private readonly tx: DataTransaction,
    canonicalUserId: string,
  ) {
    this.canonicalUserId = decimalIdDto.parse(canonicalUserId);
  }

  private readonly canonicalUserId: string;

  async resolve(input: WorkflowManagedMcpScopeInput) {
    const rows = await this.tx.select({
      workflow_run_id: runs.id,
      thread_id: runs.source_voice_thread_id,
      workspace_id: runs.workspace_id,
    }).from(runs).innerJoin(workspaces, eq(workspaces.id, runs.workspace_id)).where(and(
      eq(runs.id, input.workflow_run_id),
      eq(runs.source_voice_thread_id, input.thread_id),
      eq(runs.created_by, this.canonicalUserId),
      eq(workspaces.owner_id, sql`${this.canonicalUserId}::bigint`),
    )).limit(1);
    return rows[0] ?? null;
  }
}
