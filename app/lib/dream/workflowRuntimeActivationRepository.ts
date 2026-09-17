// [Input] Canonical actor, fixed activation policy and validated Run/lock facts in one caller-owned UOW.
// [Output] Typed Drizzle reads and atomic materialization/receipt/Session/Run/history writes.
// [Pos] Registry108 Repository; no connection, commit, SQL selector or filesystem operation is caller-controlled.
// [Sync] 2026-09-15: preserve the original durable Runtime activation rows inside one Admin transaction.
import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  agent_sessions as sessions,
  claude_plugin_installations as installations,
  deck_runtime_plugin_locks as locks,
  runtime_load_receipt_entries as receiptEntries,
  runtime_load_receipts as receipts,
  runtime_plugin_materializations as materializations,
  workflow_run_transitions as transitions,
  workflow_runs as runs,
} from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { WorkflowRuntimeActivationInput, WorkflowRuntimeActivationPolicy } from "./workflowRuntimeActivationDto";

export type RuntimeMaterializationInsert = typeof materializations.$inferInsert;
export type RuntimeReceiptInsert = typeof receipts.$inferInsert;
export type RuntimeReceiptEntryInsert = typeof receiptEntries.$inferInsert;
export type RuntimeSessionInsert = typeof sessions.$inferInsert;

export class WorkflowRuntimeActivationRepository {
  constructor(private readonly tx: DataTransaction) {}

  async clock() {
    const result = await this.tx.execute(sql`SELECT clock_timestamp()::text AS value`);
    return String(result.rows[0]?.value ?? "");
  }

  async ownedRun(canonicalUserId: string, input: WorkflowRuntimeActivationInput) {
    decimalIdDto.parse(canonicalUserId);
    return (await this.tx.select({
      workflow_run_id: runs.id,
      workspace_id: runs.workspace_id,
      deck_plugin_id: runs.deck_plugin_id,
      deck_plugin_version: runs.deck_plugin_version,
      deck_plugin_manifest_hash: runs.deck_plugin_manifest_hash,
      runtime_plugin_lock_id: runs.runtime_plugin_lock_id,
      runtime_load_receipt_id: runs.runtime_load_receipt_id,
      agent_session_id: runs.agent_session_id,
      source_voice_thread_id: runs.source_voice_thread_id,
      status: runs.status,
      status_version: runs.status_version,
      created_by: runs.created_by,
      started_at: runs.started_at,
      completed_at: runs.completed_at,
    }).from(runs).innerJoin(workspaces, eq(workspaces.id, runs.workspace_id)).where(and(
      eq(runs.id, input.workflow_run_id),
      eq(runs.source_voice_thread_id, input.thread_id),
      eq(runs.created_by, canonicalUserId),
      eq(workspaces.owner_id, sql`${canonicalUserId}::bigint`),
    )).limit(1).for("update"))[0] ?? null;
  }

  async runtimeLock(lockId: string) {
    return (await this.tx.select({ id: locks.id, lock_json: locks.lock_json }).from(locks)
      .where(eq(locks.id, lockId)).limit(1).for("share"))[0] ?? null;
  }

  async readyInstallation(packageSpec: string, version: string, artifactDigest: string, sourceType: "platform-builtin") {
    return (await this.tx.select({ id: installations.id, artifact_path: installations.artifact_path,
      requested_package_spec: installations.requested_package_spec, resolved_version: installations.resolved_version,
      artifact_digest: installations.artifact_digest, source_type: installations.source_type, status: installations.status })
      .from(installations).where(and(eq(installations.requested_package_spec, packageSpec),
        eq(installations.resolved_version, version), eq(installations.artifact_digest, artifactDigest),
        eq(installations.source_type, sourceType), eq(installations.status, "ready")))
      .orderBy(desc(installations.installed_at), desc(installations.id)).limit(1).for("share"))[0] ?? null;
  }

  async materializationByKey(key: string) {
    return (await this.tx.select({ id: materializations.runtime_materialization_id }).from(materializations)
      .where(eq(materializations.materialization_key, key)).limit(1).for("update"))[0] ?? null;
  }

  async insertMaterialization(value: RuntimeMaterializationInsert) {
    await this.tx.insert(materializations).values(value);
  }

  async refreshMaterialization(id: string, artifactDigest: string, cacheRef: string, now: string) {
    await this.tx.update(materializations).set({ materialized_digest: artifactDigest,
      declaration_status: "declared", materialization_status: "materialized", activation_status: "loadable",
      verification_status: "verified", cache_ref: cacheRef, last_error: null, updated_at: now })
      .where(eq(materializations.runtime_materialization_id, id));
  }

  async matchingMaterializations(policy: WorkflowRuntimeActivationPolicy, artifactSetHash: string) {
    return this.tx.select({
      runtime_materialization_id: materializations.runtime_materialization_id,
      runtime_environment_id: materializations.runtime_environment_id,
      runtime_pool_id: materializations.runtime_pool_id,
      runtime_node_id: materializations.runtime_node_id,
      claude_code_plugin_id: materializations.claude_code_plugin_id,
      resolved_version: materializations.resolved_version,
      artifact_digest: materializations.artifact_digest,
      materialized_digest: materializations.materialized_digest,
      artifact_set_hash: materializations.artifact_set_hash,
      policy_revision: materializations.policy_revision,
      declaration_status: materializations.declaration_status,
      materialization_status: materializations.materialization_status,
      activation_status: materializations.activation_status,
      verification_status: materializations.verification_status,
      signature_bundle_ref: materializations.signature_bundle_ref,
      retention_state: materializations.retention_state,
      restore_source_ref: materializations.restore_source_ref,
    }).from(materializations).where(and(
      eq(materializations.runtime_environment_id, policy.runtime_environment_id),
      eq(materializations.runtime_pool_id, policy.runtime_pool_id),
      eq(materializations.runtime_node_id, policy.runtime_node_id),
      eq(materializations.artifact_set_hash, artifactSetHash),
      eq(materializations.policy_revision, policy.policy_revision),
      eq(materializations.declaration_status, "declared"),
      eq(materializations.materialization_status, "materialized"),
      sql`${materializations.activation_status} IN ('loadable', 'loaded')`,
    )).orderBy(materializations.claude_code_plugin_id).for("update");
  }

  async activeSession(sessionId: string) {
    return (await this.tx.select({ agent_session_id: sessions.agent_session_id,
      workflow_run_id: sessions.workflow_run_id, runtime_load_receipt_id: sessions.runtime_load_receipt_id,
      runtime_plugin_lock_id: sessions.runtime_plugin_lock_id, remote_session_ref: sessions.remote_session_ref,
      status: sessions.status })
      .from(sessions).where(eq(sessions.agent_session_id, sessionId)).limit(1).for("share"))[0] ?? null;
  }

  async nextAttempt(workflowRunId: string) {
    const rows = await this.tx.select({ value: sql<number>`COALESCE(MAX(${sessions.attempt_number}), 0) + 1` })
      .from(sessions).where(eq(sessions.workflow_run_id, workflowRunId));
    return Number(rows[0]?.value ?? 1);
  }

  async insertReceipt(value: RuntimeReceiptInsert, entries: RuntimeReceiptEntryInsert[]) {
    await this.tx.insert(receipts).values(value);
    if (entries.length > 0) await this.tx.insert(receiptEntries).values(entries);
  }

  async markMaterializationsLoaded(ids: string[], now: string) {
    for (const id of ids) {
      await this.tx.update(materializations).set({ activation_status: "loaded", updated_at: now })
        .where(eq(materializations.runtime_materialization_id, id));
    }
  }

  async insertCreatingSession(value: RuntimeSessionInsert, leaseSeconds: number) {
    await this.tx.insert(sessions).values({ ...value, status: "creating", started_at: null,
      terminated_at: null, error_code: null, termination_reason_code: null,
      lease_expires_at: sql`${value.created_at}::timestamptz + ${leaseSeconds}::integer * interval '1 second'` });
  }

  async recordRemoteStart(sessionId: string, ownerToken: string, remoteSessionRef: string) {
    const rows = await this.tx.update(sessions).set({ remote_session_ref: remoteSessionRef })
      .where(and(eq(sessions.agent_session_id, sessionId), eq(sessions.status, "creating"),
        eq(sessions.owner_token, ownerToken))).returning({ id: sessions.agent_session_id });
    return rows.length === 1;
  }

  async activateSession(sessionId: string, ownerToken: string, now: string) {
    const rows = await this.tx.update(sessions).set({ status: "active", started_at: now,
      lease_expires_at: null, owner_token: null })
      .where(and(eq(sessions.agent_session_id, sessionId), eq(sessions.status, "creating"),
        eq(sessions.owner_token, ownerToken), sql`${sessions.remote_session_ref} IS NOT NULL`))
      .returning({ id: sessions.agent_session_id });
    return rows.length === 1;
  }

  async activateRun(current: NonNullable<Awaited<ReturnType<WorkflowRuntimeActivationRepository["ownedRun"]>>>,
    receiptId: string, sessionId: string, now: string) {
    const rows = await this.tx.update(runs).set({ status: "running", status_version: current.status_version + 1,
      runtime_load_receipt_id: receiptId, agent_session_id: sessionId,
      failed_step: null, error_code: null, started_at: current.started_at ?? now })
      .where(and(eq(runs.id, current.workflow_run_id), eq(runs.status, "queued"), eq(runs.status_version, current.status_version),
        sql`${runs.runtime_load_receipt_id} IS NULL`, sql`${runs.agent_session_id} IS NULL`))
      .returning({ id: runs.id });
    return rows.length === 1;
  }

  async appendTransition(workflowRunId: string, transitionSeq: number, actorId: string, now: string) {
    await this.tx.insert(transitions).values({ id: `wrt_${randomUUID().replaceAll("-", "")}`,
      workflow_run_id: workflowRunId, transition_seq: transitionSeq, from_status: "queued", to_status: "running",
      actor_id: actorId, reason_code: "agent_session_active", failed_step: null, error_code: null, occurred_at: now });
  }
}
