// [Input] Server lease configuration and Notion context/policy transition codec.
// [Output] Deterministic policy, monotonic context and closed-config failure evidence.
// [Pos] Provider-free unit gate; PostgreSQL and production-route journeys are separate.
// [Sync] 2026-10-07: cover policy closure, ABA revision and latest desired preservation.
import { afterEach, expect, it, vi } from "vitest";
import { notionSyncExecutionPolicy, requireNotionSyncClaimsEnabled } from "../../../config/notion-sync-policy";
import { assertExternalConfig, executionState, invalidateContext, nextRevision, patchPolicy, storedPolicy, transitionPolicy } from "./notionSyncRunState";
afterEach(() => vi.unstubAllEnvs());
it("keeps claim default closed and validates heartbeat delay budget", () => {
  vi.stubEnv("NOTION_SYNC_OWNERSHIP_CLAIMS_ENABLED", "");
  expect(requireNotionSyncClaimsEnabled).toThrowError(expect.objectContaining({ code: "NOTION_SYNC_CLAIMS_DISABLED" }));
  vi.stubEnv("NOTION_SYNC_EXECUTION_POLICY_JSON", JSON.stringify({ lease_seconds: 3, heartbeat_seconds: 1, renewal_budget_seconds: 1 }));
  expect(notionSyncExecutionPolicy().lease_seconds).toBe(3);
  vi.stubEnv("NOTION_SYNC_EXECUTION_POLICY_JSON", JSON.stringify({ lease_seconds: 2, heartbeat_seconds: 1, renewal_budget_seconds: 1 }));
  expect(notionSyncExecutionPolicy).toThrowError(expect.objectContaining({ code: "NOTION_SYNC_POLICY_NOT_CONFIGURED" }));
});
it("advances context for ABA and rejects revision exhaustion", () => {
  const a = invalidateContext({}, "selection");
  const b = invalidateContext(a, "selection");
  const againA = invalidateContext(b, "selection");
  expect(executionState(againA).selection_revision).toBe(3);
  expect(nextRevision.bind(null, Number.MAX_SAFE_INTEGER)).toThrowError(expect.objectContaining({ code: "NOTION_SYNC_REVISION_EXHAUSTED" }));
});
it("rejects all caller-owned state, selection and creation policy injection", () => {
  for (const key of ["snapshot_sync_execution", "selected_databases", "selected_pages"])
    expect(() => assertExternalConfig({ [key]: {} })).toThrowError(expect.objectContaining({ code: "NOTION_SYNC_RESERVED_CONFIG" }));
  expect(() => assertExternalConfig({ snapshot_sync_policy: {} }, true)).toThrow();
});
it("keeps latest disabled policy when a claimed run completes", () => {
  const initial = storedPolicy({});
  const changed = patchPolicy({}, { ...initial, desired: { enabled: false, interval_minutes: 60, revision: 2 }, effective: { enabled: false, interval_minutes: 60, revision: 2 }, status: "disabled", last_success_at: "2001-01-01T00:00:00Z" }, null);
  expect(changed.last_success_at).toBeNull();
  const done = transitionPolicy({ snapshot_sync_policy: changed }, "succeeded", "2026-10-07T00:00:00Z", null);
  expect(done.effective).toEqual({ enabled: false, interval_minutes: 60, revision: 2 });
  expect(done.status).toBe("disabled");
  expect(done.next_sync_at).toBeNull();
  expect(() => patchPolicy({ snapshot_sync_policy: changed }, { ...changed, status: "syncing" }, null)).toThrow();
});

it("preserves unresolved legacy ownership through ordinary context and policy writes", () => {
  const initial={snapshot_sync_policy:{...storedPolicy({}),status:"syncing"}};
  const changed=invalidateContext(initial,"selection");
  const reset={...changed,snapshot_sync_policy:{...storedPolicy(changed),status:"disabled"}};
  expect(executionState(reset).legacy_owner_unresolved).toBe(true);
});
