// [Input] Canonical owner and fixed Run creation facts inside one Admin data transaction.
// [Output] Locked Preflight/release/lock/source facts and atomic Run/consumption/two-transition writes.
// [Pos] Typed original Workflow ORM; no independent pool, commit, Session, Runtime or caller-selected SQL.
// [Sync] 2026-09-15: preserve original token CAS and scope uniqueness without changing shared schema.
import { and, eq, getTableColumns, isNull, sql } from "drizzle-orm";
import { workflow_preflights as preflight, deck_plugin_bindings as binding, deck_plugin_releases as release,
  deck_runtime_plugin_locks as runtimeLock, workflow_runs as run, workflow_run_token_consumptions as consumption,
  workflow_run_transitions as transition, chat_thread as thread, chat_message as message } from "@ink-memory/db/schema/dream";
import { storyWorkspaceWorkspaces as workspace } from "@ink-memory/db/schema";
import { decimalIdDto } from "../auth/dto";
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
import { operationRequestKeyDigest } from "./receipts";
import { WorkflowRunRepository } from "./workflowRunRepository";

export class WorkflowRunCreationRepository {
  readonly runs: WorkflowRunRepository;
  constructor(private readonly tx: DataTransaction, readonly canonicalUserId: string, readonly workspaceId: string) {
    decimalIdDto.parse(canonicalUserId); this.runs = new WorkflowRunRepository(tx);
  }
  async lockKey(key: string) {
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationRequestKeyDigest("workflow-run", this.canonicalUserId, this.workspaceId, key)}, 0))`);
  }
  async assertWorkspace() {
    const row = (await this.tx.select({ id: workspace.id }).from(workspace).where(and(eq(workspace.id, this.workspaceId),
      eq(workspace.owner_id, sql`${this.canonicalUserId}::bigint`))).limit(1).for("share"))[0];
    if (!row) throw new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403);
  }
  async context(preflightId: string) {
    return (await this.tx.select({ ...getTableColumns(preflight), expires_at: sql<string>`${preflight.expires_at}::text`,
      consumed_at: sql<string | null>`${preflight.consumed_at}::text`, created_at: sql<string>`${preflight.created_at}::text`,
      updated_at: sql<string>`${preflight.updated_at}::text`, deck_plugin_binding_id: binding.deck_plugin_binding_id,
      binding_workspace_id: binding.workspace_id, binding_creator_id: binding.creator_id,
      manifest_hash: release.manifest_hash, workflow_definition_ref: release.workflow_definition_ref,
      lock_json: runtimeLock.lock_json, lock_manifest_hash: runtimeLock.deck_plugin_manifest_hash,
    }).from(preflight).innerJoin(binding, and(eq(binding.deck_id, preflight.deck_id), eq(binding.binding_revision, preflight.binding_revision),
      eq(binding.deck_plugin_id, preflight.deck_plugin_id), eq(binding.deck_plugin_version, preflight.deck_plugin_version)))
      .innerJoin(release, and(eq(release.deck_plugin_id, preflight.deck_plugin_id), eq(release.deck_plugin_version, preflight.deck_plugin_version)))
      .innerJoin(runtimeLock, and(eq(runtimeLock.id, preflight.runtime_plugin_lock_id), eq(runtimeLock.deck_plugin_id, preflight.deck_plugin_id),
        eq(runtimeLock.deck_plugin_version, preflight.deck_plugin_version)))
      .where(eq(preflight.workflow_preflight_id, preflightId)).limit(1).for("update", { of: [preflight, binding, release, runtimeLock] }))[0] ?? null;
  }
  async source(threadId: string, messageId: string) {
    return (await this.tx.select({ thread_id: thread.id, deck_id: thread.deck_id, message_id: message.id, role: message.role,
      created_at: sql<string | null>`${message.created_at}::text` }).from(thread).innerJoin(message, eq(message.thread_id, thread.id))
      .where(and(eq(thread.id, threadId), eq(message.id, messageId), eq(thread.user_id, sql`${this.canonicalUserId}::bigint`)))
      .limit(1).for("share", { of: [thread, message] }))[0] ?? null;
  }
  async tokenConsumption(digest: string) {
    return (await this.tx.select().from(consumption).where(eq(consumption.token_digest, digest)).limit(1).for("update"))[0] ?? null;
  }
  async scopedRun(key: string) {
    const row = (await this.tx.select({ id: run.id }).from(run).where(and(eq(run.workspace_id, this.workspaceId),
      eq(run.created_by, this.canonicalUserId), eq(run.idempotency_key, key))).limit(1).for("update"))[0];
    return row ? this.runs.read(this.canonicalUserId, { workspace_id: this.workspaceId, workflow_run_id: row.id }) : null;
  }
  async clock() { return (await this.tx.execute<{ clock: string }>(sql`SELECT clock_timestamp()::text AS clock`)).rows[0].clock; }
  async insertRun(fields: typeof run.$inferInsert) { await this.tx.insert(run).values(fields); }
  async consume(fields: Omit<typeof consumption.$inferInsert, "consumed_at">, consumedAt: string, updatedAt: string) {
    await this.tx.insert(consumption).values(fields);
    const rows = await this.tx.update(preflight).set({ consumed_at: consumedAt, updated_at: updatedAt })
      .where(and(eq(preflight.workflow_preflight_id, fields.workflow_preflight_id), eq(preflight.created_by, this.canonicalUserId),
        eq(preflight.status, "passed"), isNull(preflight.consumed_at))).returning({ id: preflight.workflow_preflight_id });
    if (rows.length !== 1) throw new AuthBoundaryError("PREFLIGHT_TOKEN_REPLAYED", 409);
  }
  async queue(runId: string) {
    const rows = await this.tx.update(run).set({ status: "queued", status_version: 2 })
      .where(and(eq(run.id, runId), eq(run.workspace_id, this.workspaceId), eq(run.created_by, this.canonicalUserId),
        eq(run.status, "preflight"), eq(run.status_version, 1))).returning({ id: run.id });
    if (rows.length !== 1) throw new AuthBoundaryError("ILLEGAL_RUN_TRANSITION", 409);
  }
  async append(fields: typeof transition.$inferInsert) { await this.tx.insert(transition).values(fields); }
}
export type WorkflowRunCreationContext = NonNullable<Awaited<ReturnType<WorkflowRunCreationRepository["context"]>>>;
