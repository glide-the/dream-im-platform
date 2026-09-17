// [Input] Static complete Plugin manifest/lock and installation facts without DB/provider credentials.
// [Output] Fresh independent fixtures for original model/compatibility/source parity validation.
// [Pos] Provider-free harness only; no production constants or Runtime authority.
// [Sync] 2026-09-15: preserve source model defaults and original declared lock evidence.
export function compatibilityFixture() {
  const manifest = { schema_version: "deck-plugin/v1", deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", display_name: "Story", description: "Story plugin", author: "Fixture", status: "published",
    workflow: { workflow_definition_ref: "workflow", input_schema_ref: "schema://input", output_schema_ref: "story-workspace/output", steps: [{ step_id: "start", required_capabilities: ["story.workspace.propose"] }] },
    compatibility: { deck_host_api: "*", claude_agent_contract: "*", claude_code: "*", story_output_schema: "*", deck_runtime_snapshot_contract: "*" },
    runtime_configuration: { profile_contract: "profile/v1", required_config_keys: [], secret_ref_kinds: [], allow_profile_versions: "*" }, capabilities: ["story.workspace.propose"],
    runtime: { claude_code_plugins: [{ claude_code_plugin_id: "example.runtime", source_ref: "package:example", version_constraint: "*", required: true, capability_bindings: ["story.workspace.propose"] }] }, dependencies: {} };
  const lock = { runtime_plugin_lock_id: `rpl_${"a".repeat(32)}`, deck_plugin_id: manifest.deck_plugin_id, deck_plugin_version: manifest.deck_plugin_version,
    deck_plugin_manifest_hash: `sha256:${"b".repeat(64)}`, claude_code_plugins: [{ claude_code_plugin_id: "example.runtime", resolved_version: "1.0.0", source_ref: "package:example", artifact_digest: `sha256:${"c".repeat(64)}`, required: true }], created_at: "2026-09-15T00:00:00.123456+00:00" };
  return { manifest, lock, input: { workspace_id: "workspace", deck_plugin_id: manifest.deck_plugin_id, deck_plugin_version: manifest.deck_plugin_version },
    release: { status: "published", manifest_json: JSON.stringify(manifest), manifest_hash: lock.deck_plugin_manifest_hash, workflow_definition_ref: "workflow" },
    installation: { id: `dpi_${"d".repeat(32)}`, scope_type: "workspace", scope_id: "workspace", status: "ready", installed_versions_json: '["1.0.0"]', approved_capabilities_json: '["story.workspace.propose"]' },
    lockFacts: { id: lock.runtime_plugin_lock_id, deck_plugin_manifest_hash: lock.deck_plugin_manifest_hash, lock_json: JSON.stringify(lock) } };
}
