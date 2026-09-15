// [Input] Owned locked Run and fixed runtime binding/clock/CAS/history facts in the caller's data UOW.
// [Output] Original Session activation, status CAS and one appended transition without independent commit.
// [Pos] Typed Workflow mutation ORM; request bodies never select table/columns or issue SQL.
// [Sync] 2026-09-15: lock immutable readiness/session bindings and retain exact shared timestamp text.
import { and, eq, sql } from "drizzle-orm";
import { workflow_runs as run, workflow_run_transitions as transition, runtime_load_receipts as receipt,
  agent_sessions as session, deck_runtime_plugin_locks as runtimeLock } from "@ink-memory/db/schema/dream";
import type { DataTransaction, SchemaRequirement } from "./database";
import type { WorkflowRun } from "./workflowRunDto";

export const workflowLocalPlacementSchemaRequirement: SchemaRequirement = { capability: "dream.runtime.local-placement.v1", version: 1, contractSha256: "87fbd3c28bc077992bfa0e12674e71b59182ea08934314c02560c8b577c50983" };
export class WorkflowRunCommandRepository {
  constructor(private readonly tx: DataTransaction) {}
  async clock() {
    const result = await this.tx.execute(sql`SELECT clock_timestamp()::text AS value`);
    return result.rows[0]?.value as string;
  }
  async readiness(receiptId: string) {
    const rows = await this.tx.select({ receipt_id: receipt.receipt_id, workflow_run_id: receipt.workflow_run_id,
      runtime_plugin_lock_id: receipt.runtime_plugin_lock_id, runtime_plugin_lock_digest: receipt.runtime_plugin_lock_digest,
      required_entries_ready: receipt.required_entries_ready, runtime_environment_id: receipt.runtime_environment_id,
      runtime_pool_id: receipt.runtime_pool_id, distribution_mode: receipt.distribution_mode, runtime_node_id: receipt.runtime_node_id,
      artifact_set_hash: receipt.artifact_set_hash, policy_revision: receipt.policy_revision, deployment_tier: receipt.deployment_tier,
    }).from(receipt).where(eq(receipt.receipt_id, receiptId)).limit(1).for("share");
    return rows[0] ?? null;
  }
  async lockJson(lockId: string) {
    const rows = await this.tx.select({ lock_json: runtimeLock.lock_json }).from(runtimeLock).where(eq(runtimeLock.id, lockId)).limit(1).for("share");
    return rows[0]?.lock_json ?? null;
  }
  async session(sessionId: string) {
    const rows = await this.tx.select({ workflow_run_id: session.workflow_run_id, runtime_load_receipt_id: session.runtime_load_receipt_id,
      runtime_plugin_lock_id: session.runtime_plugin_lock_id, runtime_plugin_lock_digest: session.runtime_plugin_lock_digest,
      runtime_environment_id: session.runtime_environment_id, runtime_pool_id: session.runtime_pool_id, distribution_mode: session.distribution_mode,
      runtime_node_id: session.runtime_node_id, artifact_set_hash: session.artifact_set_hash, policy_revision: session.policy_revision,
      deployment_tier: session.deployment_tier, status: session.status,
    }).from(session).where(eq(session.agent_session_id, sessionId)).limit(1).for("update");
    return rows[0] ?? null;
  }
  async activateSession(sessionId: string, now: string) {
    const rows = await this.tx.update(session).set({ status: "active", started_at: now, lease_expires_at: null, owner_token: null })
      .where(and(eq(session.agent_session_id, sessionId), eq(session.status, "creating"))).returning({ id: session.agent_session_id });
    return rows.length === 1;
  }
  async advance(current: WorkflowRun, target: "running" | "failed" | "cancelled", now: string, details: { runtime_load_receipt_id: string | null; agent_session_id: string | null; failed_step: string | null; error_code: string | null }) {
    const rows = await this.tx.update(run).set({ status: target, status_version: current.status_version + 1,
      runtime_load_receipt_id: details.runtime_load_receipt_id, agent_session_id: details.agent_session_id,
      failed_step: target === "failed" ? details.failed_step : null, error_code: target === "failed" ? details.error_code : null,
      started_at: target === "running" ? current.started_at ?? now : current.started_at,
      completed_at: target === "running" ? current.completed_at : now,
    }).where(and(eq(run.id, current.workflow_run_id), eq(run.status, current.status), eq(run.status_version, current.status_version)))
      .returning({ id: run.id });
    return rows.length === 1;
  }
  async append(event: typeof transition.$inferInsert) { await this.tx.insert(transition).values(event); }
}
