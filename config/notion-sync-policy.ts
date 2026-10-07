// [Input] Existing Notion product policy and explicit Admin-owned execution timing configuration.
// [Output] Strict lease/heartbeat budget and a default-closed claim rollout gate.
// [Pos] Server configuration; lease timing is independent of product sync intervals and deployment labels.
// [Sync] 2026-10-07: separate publication readiness from exact schema capability registration.
import { z } from "zod";
import { AuthBoundaryError } from "../app/lib/auth/config";

export const notionSyncPolicy = Object.freeze({
  defaultEnabled: true,
  defaultIntervalMinutes: 15,
  defaultRevision: 1,
  allowedIntervalMinutes: [15, 60, 360, 1440] as const,
});
export const notionSyncExecutionPolicyDto = z.strictObject({
  lease_seconds: z.number().int().positive().safe(),
  heartbeat_seconds: z.number().int().positive().safe(),
  renewal_budget_seconds: z.number().int().positive().safe(),
}).refine(p => p.heartbeat_seconds + p.renewal_budget_seconds < p.lease_seconds,
  "Heartbeat and renewal budget must fit inside the lease");
export function notionSyncExecutionPolicy() {
  try {
    return notionSyncExecutionPolicyDto.parse(JSON.parse(process.env.NOTION_SYNC_EXECUTION_POLICY_JSON ?? ""));
  } catch { throw new AuthBoundaryError("NOTION_SYNC_POLICY_NOT_CONFIGURED", 503); }
}
export function requireNotionSyncClaimsEnabled() {
  if (process.env.NOTION_SYNC_OWNERSHIP_CLAIMS_ENABLED !== "true")
    throw new AuthBoundaryError("NOTION_SYNC_CLAIMS_DISABLED", 503);
}
