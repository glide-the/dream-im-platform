// [Input] Admin-owned connector execution JSON and the current stored sync policy.
// [Output] Strict single-run state, monotonic revisions and current-policy-preserving transitions.
// [Pos] Pure Notion execution codec; no clocks, SQL, credentials or environment-name behavior.
// [Sync] 2026-10-07: recognize context ABA without using content hashes as revisions.
import { z } from "zod";
import { notionSyncPolicy } from "../../../config/notion-sync-policy";
import { AuthBoundaryError } from "../auth/config";
import { isoTimeDto } from "../auth/dto";

export const executionConfigKey = "snapshot_sync_execution";
export const syncPolicyConfigKey = "snapshot_sync_policy";
const revision = z.number().int().nonnegative().safe();
export const notionRunDto = z.strictObject({
  run_id: z.uuid(), fence_epoch: revision,
  service_client_id: z.string().min(1), worker_id: z.uuid(), owner_user_id: z.string().regex(/^[1-9][0-9]*$/),
  selection_revision: revision, authorization_revision: revision, policy_revision: revision,
  started_at: isoTimeDto, heartbeat_at: isoTimeDto, lease_expires_at: isoTimeDto,
  status: z.enum(["running", "succeeded", "failed", "cancelled", "invalidated"]),
  error_code: z.enum(["NOTION_SYNC_FAILED", "NOTION_SYNC_CANCELLED", "NOTION_SYNC_CONTEXT_CHANGED", "NOTION_UPSTREAM_UNAVAILABLE"]).nullable(),
});
export const notionExecutionStateDto = z.strictObject({
  schema_version: z.literal(1), selection_revision: revision, authorization_revision: revision,
  fence_epoch: revision, legacy_owner_unresolved: z.boolean().default(false), run: notionRunDto.nullable(),
});
export type NotionExecutionState = z.infer<typeof notionExecutionStateDto>;
export type NotionRun = z.infer<typeof notionRunDto>;
export function executionState(config: Record<string, unknown>): NotionExecutionState {
  if (!Object.hasOwn(config, executionConfigKey))
    return { schema_version: 1, selection_revision: 0, authorization_revision: 0, fence_epoch: 0,
      legacy_owner_unresolved: typeof config[syncPolicyConfigKey] === "object" && config[syncPolicyConfigKey] !== null
        && "status" in config[syncPolicyConfigKey] && config[syncPolicyConfigKey].status === "syncing", run: null };
  const parsed = notionExecutionStateDto.safeParse(config[executionConfigKey]);
  if (!parsed.success) throw new AuthBoundaryError("NOTION_SYNC_EXECUTION_INVALID", 503);
  if (parsed.data.run === null && typeof config[syncPolicyConfigKey] === "object" && config[syncPolicyConfigKey] !== null
    && "status" in config[syncPolicyConfigKey] && config[syncPolicyConfigKey].status === "syncing") parsed.data.legacy_owner_unresolved = true;
  return parsed.data;
}
export function nextRevision(value: number) {
  if (!Number.isSafeInteger(value) || value >= Number.MAX_SAFE_INTEGER)
    throw new AuthBoundaryError("NOTION_SYNC_REVISION_EXHAUSTED", 503);
  return value + 1;
}
export function invalidateContext(config: Record<string, unknown>, kind: "selection" | "authorization") {
  const state = executionState(config);
  state[`${kind}_revision`] = nextRevision(state[`${kind}_revision`]);
  if (state.run?.status === "running") {
    state.run = { ...state.run, status: "invalidated", error_code: "NOTION_SYNC_CONTEXT_CHANGED" };
  }
  return { ...config, [executionConfigKey]: state };
}
const ruleDto = z.strictObject({ enabled: z.boolean(), interval_minutes: z.number().refine(
  value => notionSyncPolicy.allowedIntervalMinutes.some(interval => interval === value)), revision: z.number().int().positive().safe() });
export const storedSyncPolicyDto = z.object({
  schema_version: z.literal(1), desired: ruleDto, effective: ruleDto,
  status: z.enum(["applied", "syncing", "error", "disabled"]),
  last_attempt_at: isoTimeDto.nullable().optional(), last_success_at: isoTimeDto.nullable().optional(),
  last_error_code: z.string().nullable().optional(), next_sync_at: isoTimeDto.nullable().optional(),
}).passthrough().refine(p => p.desired.revision === p.effective.revision
  && p.desired.enabled === p.effective.enabled && p.desired.interval_minutes === p.effective.interval_minutes);
export function storedPolicy(config: Record<string, unknown>) {
  const raw = config[syncPolicyConfigKey];
  if (raw === undefined) {
    const rule = { enabled: notionSyncPolicy.defaultEnabled, interval_minutes: notionSyncPolicy.defaultIntervalMinutes, revision: notionSyncPolicy.defaultRevision };
    return { schema_version: 1 as const, desired: rule, effective: rule, status: "applied" as const,
      last_attempt_at: null, last_success_at: null, last_error_code: null, next_sync_at: null };
  }
  const parsed = storedSyncPolicyDto.safeParse(raw);
  if (!parsed.success) throw new AuthBoundaryError("NOTION_SYNC_STORED_POLICY_INVALID", 503);
  return parsed.data;
}
export function transitionPolicy(config: Record<string, unknown>, status: "started" | "succeeded" | "failed" | "idle" | "cleared", now: string, lastSynced: string | null, errorCode: string | null = null) {
  const policy = storedPolicy(config);
  const lastSuccess = status === "cleared" ? null : status === "succeeded" ? now : policy.last_success_at ?? lastSynced;
  return {
    ...policy,
    status: status === "started" ? "syncing" : !policy.effective.enabled ? "disabled" : status === "failed" ? "error" : "applied",
    last_attempt_at: status === "cleared" ? null : status === "idle" ? policy.last_attempt_at ?? null : now,
    last_success_at: lastSuccess,
    last_error_code: status === "failed" ? errorCode : null,
    next_sync_at: !policy.effective.enabled ? null : lastSuccess === null ? now
      : new Date(Date.parse(lastSuccess) + policy.effective.interval_minutes * 60_000).toISOString(),
  };
}
export function assertExternalConfig(config: Record<string, unknown>, creating = false) {
  if ([executionConfigKey, "selected_databases", "selected_pages"].some(key => Object.hasOwn(config, key)))
    throw new AuthBoundaryError("NOTION_SYNC_RESERVED_CONFIG", 400);
  if (creating && Object.hasOwn(config, syncPolicyConfigKey))
    throw new AuthBoundaryError("NOTION_SYNC_RESERVED_CONFIG", 400);
}
export function patchPolicy(currentConfig: Record<string, unknown>, proposed: unknown, lastSynced: string | null) {
  const current = storedPolicy(currentConfig);
  const parsed = storedSyncPolicyDto.safeParse(proposed);
  if (!parsed.success || !["applied", "disabled"].includes(parsed.data.status)
    || parsed.data.desired.revision !== nextRevision(current.desired.revision))
    throw new AuthBoundaryError("NOTION_SYNC_POLICY_REVISION_CONFLICT", 409);
  // Only the new rule is caller-authored. Execution diagnostics remain Admin-owned.
  return { ...current, desired: parsed.data.desired, effective: parsed.data.effective,
    status: parsed.data.effective.enabled ? executionState(currentConfig).run?.status === "running" ? "syncing" : "applied" : "disabled",
    next_sync_at: parsed.data.effective.enabled && (current.last_success_at ?? lastSynced)
      ? new Date(Date.parse((current.last_success_at ?? lastSynced)!) + parsed.data.effective.interval_minutes * 60_000).toISOString() : null,
  };
}
