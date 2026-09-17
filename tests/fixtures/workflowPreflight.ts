// [Input] Static complete original passed Preflight fields and one-microsecond active clock.
// [Output] Fresh safe provider-free row facts for lifecycle/expiry/signing compatibility tests.
// [Pos] Technical test fixture; no database, real identity or executable state machine.
// [Sync] 2026-09-15: align with the original Python fixed HMAC known vector.
export function validWorkflowPreflightRow() {
  return { workflow_preflight_id: `pf_${"a".repeat(32)}`, deck_id: "deck", binding_revision: 7, deck_plugin_id: "plugin", deck_plugin_version: "1.0.0",
    runtime_plugin_lock_id: "lock_😀", deck_runtime_profile_id: "profile", deck_runtime_snapshot_id: "snapshot_中文", deck_runtime_snapshot_summary_hash: "summary",
    input_hash: `sha256:${"b".repeat(64)}`, status: "passed", error_code: null as string | null, failed_check: null as string | null,
    expires_at: "2026-09-14 00:00:00.123456+00", created_by: "9007199254740993", created_at: "2026-09-13 23:59:00.123456+00",
    consumed_at: null as string | null, clock: "2026-09-14 00:00:00.123455+00" };
}
