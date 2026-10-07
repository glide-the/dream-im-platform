// [Input] Locked connector context, verified service/actor, strict run DTO and explicit server lease policy.
// [Output] Single-owner claims, fenced renew/finish and final database-clock validation in the same UOW.
// [Pos] Notion execution Repository; reuses the canonical snapshot persistence kernel and identity tables.
// [Sync] 2026-10-07: fence all outcomes and keep latest policy plus LKG atomic with receipt/audit.
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { resource_connectors as connectors, connector_snapshots as snapshots } from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { notionSyncExecutionPolicy, requireNotionSyncClaimsEnabled } from "../../../config/notion-sync-policy";
import { NotionConnectorRepository } from "./notionConnectorRepository";
import { notionConnectorDto, notionSnapshotMetadataDto, notionSnapshotDto } from "./notionConnectorDto";
import { notionLightSnapshotDto } from "./notionLightSnapshotDto";
import { notionSyncRunClaimDto, notionSyncRunKeyDto, notionSyncRunFinishDto, notionSyncRunOutputDto } from "./notionSyncRunDto";
import { executionConfigKey, executionState, nextRevision, storedPolicy, syncPolicyConfigKey, transitionPolicy, type NotionRun } from "./notionSyncRunState";

type Connector = z.infer<typeof notionConnectorDto>;
type RunKey = z.infer<typeof notionSyncRunKeyDto>;
export class NotionSyncRunRepository extends NotionConnectorRepository {
  private async clock() {
    const result = await this.tx.execute(sql`SELECT clock_timestamp()::text AS now`);
    const row = result.rows[0] as { now: string } | undefined;
    const now = new Date(row?.now);
    if (!Number.isFinite(now.getTime())) throw new AuthBoundaryError("NOTION_SYNC_DATABASE_CLOCK_UNAVAILABLE", 503);
    return now;
  }
  private async activeActor(userId: string, subject?: string) {
    const result = await this.tx.execute(sql`SELECT identity.lock_active_notion_sync_actor(${userId}::bigint, ${subject ?? null}::text) AS active`);
    if ((result.rows[0] as { active?: boolean } | undefined)?.active !== true)
      throw new AuthBoundaryError("ACTIVE_SUBJECT_REQUIRED", 403);
  }
  private async persist(current: Connector, config: Record<string, unknown>) {
    await this.tx.update(connectors).set({ config_json: JSON.stringify(config), updated_at: sql`clock_timestamp()` })
      .where(eq(connectors.id, current.id));
  }
  private async result(current: Connector, status: z.infer<typeof notionSyncRunOutputDto>["status"], now: Date, run: NotionRun | null, retry: string | null = null, snapshot: z.infer<typeof notionSyncRunOutputDto>["snapshot"] = null) {
    return notionSyncRunOutputDto.parse({ status, connector: await this.requireConnector(current.id, { background: true }),
      run, server_now: now.toISOString(), retry_at: retry, execution_policy: notionSyncExecutionPolicy(), snapshot });
  }
  async claim(input: z.infer<typeof notionSyncRunClaimDto>, serviceId: string, manual: boolean, subject?: string) {
    requireNotionSyncClaimsEnabled();
    const policy = notionSyncExecutionPolicy();
    const current = await this.storedConnector(input.connector_id, !manual);
    await this.activeActor(current.user_id, subject);
    const now = await this.clock();
    if (current.platform !== "notion" || current.auth_status !== "authenticated")
      throw new AuthBoundaryError("NOTION_SYNC_AUTH_REQUIRED", 409);
    if (current.sources.length === 0) throw new AuthBoundaryError("NOTION_SYNC_SOURCES_REQUIRED", 409);
    const state = executionState(current.config);
    const syncPolicy = storedPolicy(current.config);
    if (state.legacy_owner_unresolved || (state.run === null && syncPolicy.status === "syncing"))
      throw new AuthBoundaryError("NOTION_SYNC_LEGACY_OWNER_UNRESOLVED", 409);
    if (state.run?.status === "running" && Date.parse(state.run.lease_expires_at) > now.getTime())
      return this.result(current, "busy", now, null, state.run.lease_expires_at);
    const lastSuccess = syncPolicy.last_success_at ?? current.last_synced_at;
    if (!manual && (!syncPolicy.effective.enabled || (lastSuccess !== null
      && Date.parse(lastSuccess) + syncPolicy.effective.interval_minutes * 60_000 > now.getTime())))
      return this.result(current, "not_due", now, null);
    state.fence_epoch = nextRevision(state.fence_epoch);
    state.run = {
      run_id: randomUUID(), fence_epoch: state.fence_epoch, service_client_id: serviceId, worker_id: input.worker_id,
      owner_user_id: current.user_id, selection_revision: state.selection_revision,
      authorization_revision: state.authorization_revision, policy_revision: syncPolicy.desired.revision,
      started_at: now.toISOString(), heartbeat_at: now.toISOString(),
      lease_expires_at: new Date(now.getTime() + policy.lease_seconds * 1000).toISOString(), status: "running", error_code: null,
    };
    await this.persist(current, { ...current.config, [executionConfigKey]: state,
      [syncPolicyConfigKey]: transitionPolicy(current.config, "started", now.toISOString(), current.last_synced_at) });
    return this.result(current, "claimed", now, state.run);
  }
  private match(current: Connector, key: RunKey, serviceId: string, now: Date) {
    const state = executionState(current.config);
    const run = state.run;
    if (!run || run.run_id !== key.run_id || run.fence_epoch !== key.fence_epoch
      || run.worker_id !== key.worker_id || run.service_client_id !== serviceId)
      throw new AuthBoundaryError("NOTION_SYNC_RUN_INVALID", 409);
    if (run.owner_user_id !== current.user_id || run.selection_revision !== state.selection_revision
      || run.authorization_revision !== state.authorization_revision || current.auth_status !== "authenticated"
      || current.platform !== "notion" || current.sources.length === 0)
      throw new AuthBoundaryError("NOTION_SYNC_CONTEXT_CHANGED", 409);
    if (run.status !== "running") throw new AuthBoundaryError("NOTION_SYNC_RUN_INVALID", 409);
    if (Date.parse(run.lease_expires_at) <= now.getTime()) throw new AuthBoundaryError("NOTION_SYNC_LEASE_EXPIRED", 409);
    return state;
  }
  async renew(key: RunKey, serviceId: string) {
    const current = await this.storedConnector(key.connector_id, true);
    await this.activeActor(current.user_id);
    const now = await this.clock();
    const state = this.match(current, key, serviceId, now);
    state.run = { ...state.run!, heartbeat_at: now.toISOString(),
      lease_expires_at: new Date(now.getTime() + notionSyncExecutionPolicy().lease_seconds * 1000).toISOString() };
    await this.persist(current, { ...current.config, [executionConfigKey]: state });
    return this.result(current, "renewed", now, state.run);
  }
  async finish(input: z.infer<typeof notionSyncRunFinishDto>, serviceId: string) {
    const current = await this.storedConnector(input.connector_id, true);
    await this.activeActor(current.user_id);
    const now = await this.clock();
    const state = this.match(current, input, serviceId, now);
    const outcome = input.outcome;
    let snapshot: z.infer<typeof notionSyncRunOutputDto>["snapshot"] = null;
    if (outcome.status === "succeeded") {
      const metadata = notionSnapshotMetadataDto.parse(outcome.snapshot.metadata);
      if (outcome.workspace_id !== current.id || metadata.workspace_id !== current.id || metadata.resource_connector_id !== current.id)
        throw new AuthBoundaryError("NOTION_SNAPSHOT_IDENTITY_CONFLICT", 409);
      if (typeof outcome.snapshot.pages !== "object" || outcome.snapshot.pages === null || Array.isArray(outcome.snapshot.pages)
        || Object.keys(outcome.snapshot.pages).length !== 0)
        throw new AuthBoundaryError("NOTION_SNAPSHOT_INVALID", 422);
      const prior = await this.tx.select({ id: snapshots.id }).from(snapshots).where(and(
        eq(snapshots.connector_id, current.id), eq(snapshots.snapshot_version, metadata.snapshot_version))).limit(1);
      if (prior.length) throw new AuthBoundaryError("NOTION_SNAPSHOT_VERSION_CONFLICT", 409);
      const selected = new Set(current.sources.map(source => `${source.resource_type}:${source.external_id}`));
      const projected = new Set([
        ...outcome.snapshot.connector.selected_databases.map(id => `notion_database:${id}`),
        ...outcome.snapshot.connector.selected_pages.map(id => `notion_page:${id}`),
      ]);
      if (projected.size !== selected.size || [...projected].some(id => !selected.has(id)))
        throw new AuthBoundaryError("NOTION_SNAPSHOT_INVALID", 422);
      if (outcome.synced_resources.some(source => !selected.has(`${source.resource_type}:${source.external_id}`))
        || typeof outcome.snapshot.database_pages !== "object" || outcome.snapshot.database_pages === null
        || Array.isArray(outcome.snapshot.database_pages)
        || Object.keys(outcome.snapshot.database_pages).some(id => !selected.has(`notion_database:${id}`)))
        throw new AuthBoundaryError("NOTION_SNAPSHOT_INVALID", 422);
      snapshot = notionLightSnapshotDto.parse(await this.persistSnapshot({ connector_id: current.id, ...outcome, snapshot: notionSnapshotDto.parse(outcome.snapshot) }, true));
    }
    state.run = { ...state.run!, status: outcome.status, error_code: outcome.status === "succeeded" ? null : outcome.error_code };
    await this.persist(current, { ...current.config, [executionConfigKey]: state,
      [syncPolicyConfigKey]: transitionPolicy(current.config, outcome.status === "succeeded" ? "succeeded" : "failed", now.toISOString(), current.last_synced_at,
        outcome.status === "succeeded" ? null : outcome.error_code) });
    return this.result(current, outcome.status, now, state.run, null, snapshot);
  }
  async assertLeaseBeforeCommit(connectorId: string, run: NotionRun) {
    // Called after receipt AND audit writes. Replayed receipts deliberately skip this check.
    const current = await this.storedConnector(connectorId, true);
    const now = await this.clock();
    const stored = executionState(current.config).run;
    if (!stored || stored.run_id !== run.run_id || stored.fence_epoch !== run.fence_epoch)
      throw new AuthBoundaryError("NOTION_SYNC_RUN_INVALID", 409);
    if (Date.parse(stored.lease_expires_at) <= now.getTime()) throw new AuthBoundaryError("NOTION_SYNC_LEASE_EXPIRED", 409);
  }
}
