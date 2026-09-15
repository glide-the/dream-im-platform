// [Input] Server-derived service/subject/canonical owner and a closed original Preflight request.
// [Output] Immutable request association and owner-scoped lifecycle writes in caller-owned stages.
// [Pos] Fixed Admin ORM; no commit, Runtime, filesystem or request-selected state here.
// [Sync] 2026-09-15: preserve stage commits with distinct, stable stage audit keys under the existing unique index.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, desc, eq, getTableColumns, inArray, isNull, lte, sql } from "drizzle-orm";
import { workflowPreflightRequests as requests } from "@ink-memory/db/schema/auth";
import { workflow_preflights as preflights } from "@ink-memory/db/schema/dream";
import { adminAuditLogs, storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { operationRequestKeyDigest } from "./receipts";
import type { PreflightBindingRelease, PreflightSnapshotReceipt } from "./workflowPreflightDependencies";
import type { WorkflowPreflightExecutionInput } from "./workflowPreflightExecutionDto";
export const preflightExecuteOperation = "workflow-preflight.execute";
const preflightAuditStageDto = z.enum(["expire", "checking", "binding", "snapshot", "snapshot_binding"]);
type PreflightAuditStage = z.infer<typeof preflightAuditStageDto>;
export type PreflightRequestContext = { serviceClientId: string; actor: string; canonicalUserId: string; requestId: string;
  inputSha256: string; input: Pick<WorkflowPreflightExecutionInput, "workspace_id"> & Partial<WorkflowPreflightExecutionInput> };
export async function findOriginalPreflightRequest(tx: DataTransaction, serviceClientId: string, actor: string, requestId: string) {
  return (await tx.select().from(requests).where(and(eq(requests.serviceClientId, serviceClientId), eq(requests.actor, actor), eq(requests.requestId, requestId))).limit(1))[0] ?? null;
}
export async function lockOriginalPreflightRequest(tx: DataTransaction, serviceClientId: string, actor: string, requestId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${operationRequestKeyDigest(serviceClientId, actor, preflightExecuteOperation, requestId)}, 0))`);
}
export class WorkflowPreflightExecutionRepository {
  constructor(private readonly tx: DataTransaction, private readonly context: PreflightRequestContext) { decimalIdDto.parse(context.canonicalUserId); }
  async lockRequest() {
    const { serviceClientId, actor, requestId } = this.context;
    await lockOriginalPreflightRequest(this.tx, serviceClientId, actor, requestId);
  }
  async assertWorkspace() {
    const row = (await this.tx.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.id, this.context.input.workspace_id),
      eq(workspaces.owner_id, sql`${this.context.canonicalUserId}::bigint`))).limit(1).for("share"))[0];
    if (!row) throw new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403);
  }
  async association() {
    const { serviceClientId, actor, requestId } = this.context;
    const row = await findOriginalPreflightRequest(this.tx, serviceClientId, actor, requestId);
    if (row && (row.inputSha256 !== this.context.inputSha256 || row.canonicalUserId !== BigInt(this.context.canonicalUserId) || row.workspaceId !== this.context.input.workspace_id)) throw new AuthBoundaryError("OPERATION_REQUEST_CONFLICT", 409);
    return row ?? null;
  }
  async reserve(preflightId: string, executionOwner: boolean) {
    const { serviceClientId, actor, requestId, inputSha256, canonicalUserId, input } = this.context;
    await this.tx.insert(requests).values({ serviceClientId, actor, requestId, inputSha256, canonicalUserId: BigInt(canonicalUserId),
      workspaceId: input.workspace_id, workflowPreflightId: preflightId, executionOwner });
  }
  async read(preflightId: string) {
    const row = (await this.tx.select({ ...getTableColumns(preflights),
      expires_at: sql<string>`${preflights.expires_at}::text`, created_at: sql<string>`${preflights.created_at}::text`,
      updated_at: sql<string>`${preflights.updated_at}::text`, consumed_at: sql<string | null>`${preflights.consumed_at}::text`,
    }).from(preflights).where(and(eq(preflights.workflow_preflight_id, preflightId), eq(preflights.created_by, this.context.canonicalUserId))).limit(1).for("update"))[0];
    if (!row) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_DATA_INVALID");
    return row;
  }
  async clock() { return (await this.tx.execute<{ clock: string }>(sql`SELECT clock_timestamp()::text AS clock`)).rows[0].clock; }
  async active(fingerprint: string, now: string) {
    await this.tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"workflow-preflight-fingerprint:" + fingerprint}, 0))`);
    const expired = await this.tx.update(preflights).set({ status: "expired", preflight_token_hash: null, updated_at: now })
      .where(and(eq(preflights.request_fingerprint, fingerprint), eq(preflights.created_by, this.context.canonicalUserId), eq(preflights.status, "passed"), lte(preflights.expires_at, now))).returning({ id: preflights.workflow_preflight_id });
    if (expired.length) await this.audit("expire", { expired_count: expired.length });
    return (await this.tx.select({ id: preflights.workflow_preflight_id }).from(preflights).where(and(eq(preflights.request_fingerprint, fingerprint),
      eq(preflights.created_by, this.context.canonicalUserId), inArray(preflights.status, ["checking", "passed"]), isNull(preflights.consumed_at)))
      .orderBy(desc(preflights.created_at)).limit(1).for("update"))[0]?.id ?? null;
  }
  async checking(preflightId: string, fingerprint: string, inputHash: string, now: string, expiry: string) {
    const { deck_id, binding_revision } = this.context.input;
    if (deck_id === undefined || binding_revision === undefined) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_DATA_INVALID");
    await this.tx.insert(preflights).values({ workflow_preflight_id: preflightId, request_fingerprint: fingerprint, deck_id,
      binding_revision, input_hash: inputHash, created_by: this.context.canonicalUserId, status: "checking",
      deck_plugin_id: "unresolved", deck_plugin_version: "unresolved", runtime_plugin_lock_id: "unresolved", deck_runtime_profile_id: "unresolved",
      created_at: now, updated_at: now, expires_at: expiry });
  }
  private async update(preflightId: string, fields: Partial<typeof preflights.$inferInsert>) {
    const changed = await this.tx.update(preflights).set(fields).where(and(eq(preflights.workflow_preflight_id, preflightId),
      eq(preflights.created_by, this.context.canonicalUserId), eq(preflights.status, "checking"))).returning({ id: preflights.workflow_preflight_id });
    if (changed.length !== 1) throw new AuthBoundaryError("WORKFLOW_PREFLIGHT_DATA_INVALID");
  }
  async binding(preflightId: string, binding: PreflightBindingRelease, now: string) {
    await this.update(preflightId, { deck_plugin_id: binding.deck_plugin_id, deck_plugin_version: binding.deck_plugin_version,
      runtime_plugin_lock_id: binding.runtime_plugin_lock_id, deck_runtime_profile_id: binding.deck_runtime_profile_id, updated_at: now });
  }
  async snapshot(preflightId: string, snapshot: PreflightSnapshotReceipt, now: string) {
    await this.update(preflightId, { deck_runtime_snapshot_id: snapshot.deck_runtime_snapshot_id, deck_runtime_snapshot_summary_hash: snapshot.sanitized_summary_hash, updated_at: now });
  }
  async passed(preflightId: string, snapshot: PreflightSnapshotReceipt, tokenHash: string, expiry: string, now: string) {
    await this.update(preflightId, { status: "passed", error_code: null, failed_check: null, deck_runtime_snapshot_id: snapshot.deck_runtime_snapshot_id,
      deck_runtime_snapshot_summary_hash: snapshot.sanitized_summary_hash, preflight_token_hash: tokenHash, expires_at: expiry, updated_at: now });
  }
  async failed(preflightId: string, check: string, code: string, now: string) {
    await this.update(preflightId, { status: "failed", error_code: code, failed_check: check, preflight_token_hash: null, updated_at: now });
  }
  async audit(stage: PreflightAuditStage, facts: Record<string, string | number> = {}) {
    const validStage = preflightAuditStageDto.parse(stage);
    const { serviceClientId, actor, requestId, inputSha256 } = this.context;
    await this.tx.insert(adminAuditLogs).values({ id: `audit_${randomUUID().replaceAll("-", "")}`, actor_type: "service", actor_id: serviceClientId,
      action: "dream.workflow-preflight.stage", resource_type: "dream_operation", resource_id: operationRequestKeyDigest(serviceClientId, actor, `${preflightExecuteOperation}.stage.${validStage}`, requestId),
      request_id: requestId, metadata: { ...facts, stage: validStage, input_sha256: inputSha256 } });
  }
}
export type WorkflowPreflightExecutionRow = Awaited<ReturnType<WorkflowPreflightExecutionRepository["read"]>>;
