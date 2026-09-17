// [Input] Static complete original WorkflowRun fields for provider-free contract assertions.
// [Output] Fresh valid queued Run facts; no SQL or alternate state machine.
// [Pos] Shared test fixture used by focused DTO/service validation.
// [Sync] 2026-09-15: preserve decimal owner, source NULLs and six-digit timestamps.
const runId = `run_${"a".repeat(32)}`;
const session = `as_${"b".repeat(32)}`;
const hash = `sha256:${"c".repeat(64)}`;
export function validWorkflowRun() {
  return { workflow_run_id: runId, deck_plugin_id: "plugin", deck_plugin_version: "1.0.0", workflow_definition_ref: "flow", deck_runtime_snapshot_id: "snapshot",
    status: "queued", failed_step: null as string | null, error_code: null as string | null, retry_of_run_id: null as string | null,
    deck_plugin_manifest_hash: hash, deck_plugin_binding_id: "binding", binding_revision: 1, runtime_plugin_lock_id: "lock",
    runtime_load_receipt_id: null as string | null, workflow_preflight_id: `pf_${"d".repeat(32)}`, agent_session_id: null as string | null,
    source_voice_thread_id: null as string | null, source_message_id: null as string | null, source_message_time: null as string | null,
    workspace_id: "workspace", idempotency_key: "request", input_hash: hash, semantic_fingerprint: hash, status_version: 2,
    created_by: "9007199254740993", created_at: "2026-09-14T00:00:00.123456+00:00", started_at: null as string | null, completed_at: null as string | null };
}
