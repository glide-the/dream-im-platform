// [Input] Verified owner, fixed Plugin metadata and explicit server runtime capability facts.
// [Output] Original eight-check compatibility verdict and five-domain least-privilege capabilities.
// [Pos] Reusable Admin domain service for selection/Preflight, with Runtime/FS execution retained by Dream.
// [Sync] 2026-09-15: preserve original explicit Python lock blank checks and typed model whitespace separately.
import { AuthBoundaryError } from "../auth/config";
import { principalDto, type PrincipalDto } from "../auth/dto";
import { deckRuntimeCompatibilityPolicy } from "../../../config/dream-domain-policy";
import type { DataTransaction } from "./database";
import { parseDeckPluginManifest, stripPythonString, type DeckPluginManifestDto } from "./deckPluginManifestDto";
import { parseDeckRuntimePluginLock, type DeckRuntimePluginLock } from "./deckRuntimePluginLockDto";
import { inspectPluginCapabilitySets } from "./deckContentCanonical";
import { DeckPluginCompatibilityRepository, type DeckPluginReleaseFacts, type DeckPluginInstallationFacts, type DeckRuntimeLockFacts } from "./deckPluginCompatibilityRepository";
import { comparePythonStrings, deckPluginCompatibilityInputDto, deckPluginCompatibilityOutputDto, deckPluginCompatibilityResultDto,
  type DeckPluginCompatibilityInput, type DeckPluginCompatibilityResult } from "./deckPluginCompatibilityDto";

export function storedPluginStringSet(raw: string | null, normalize = false): Set<string> {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed) || (!normalize && parsed.some(item => typeof item !== "string"))) return new Set();
    return new Set(parsed.filter((item): item is string => typeof item === "string").map(item => normalize ? stripPythonString(item) : item).filter(item => !normalize || item !== ""));
  } catch { return new Set(); }
}
export type DeckRuntimeContext = ReturnType<typeof deckRuntimeCompatibilityPolicy> & {
  deck_runtime_snapshot_policy: Set<string>; user_and_workspace_grants: Set<string>; claude_agent_runtime_supported: Set<string>;
  materialized_runtime_plugin_ids: Set<string>; loadable_runtime_plugin_ids: Set<string>; known_capabilities: Set<string> | null;
  deprecated_release_allowed_by_policy: boolean;
};
const recovery = {
  release_available: ["DECK_PLUGIN_UNAVAILABLE", "select_available_release_or_complete_installation"],
  deck_host_compatible: ["DECK_HOST_INCOMPATIBLE", "upgrade_deck_host"],
  claude_agent_compatible: ["CLAUDE_AGENT_INCOMPATIBLE", "select_compatible_claude_agent_runtime"],
  story_schema_compatible: ["STORY_SCHEMA_INCOMPATIBLE", "select_compatible_story_schema"],
  deck_runtime_config_compatible: ["DECK_RUNTIME_CONFIG_INCOMPATIBLE", "select_compatible_deck_runtime_snapshot"],
  runtime_plugin_resolved: ["RUNTIME_PLUGIN_UNRESOLVED", "regenerate_runtime_plugin_lock"],
  workflow_permission: ["WORKFLOW_PERMISSION_DENIED", "request_required_capability_grants"],
  runtime_plugin_ready: ["RUNTIME_PLUGIN_NOT_READY", "materialize_required_runtime_plugins"],
} as const;
function failure(check: keyof typeof recovery): DeckPluginCompatibilityResult { const [error_code, recovery_action] = recovery[check]; return { passed: false, failed_check: check, error_code, recovery_action, effective_capabilities: [] }; }
export function effectivePluginCapabilities(requested: Set<string>, approved: Set<string>, context: DeckRuntimeContext) {
  const normalized = (values: Set<string>) => new Set([...values].map(stripPythonString).filter(Boolean));
  const inputs = [requested, approved, context.deck_runtime_snapshot_policy, context.user_and_workspace_grants, context.claude_agent_runtime_supported].map(normalized);
  const known = context.known_capabilities === null ? inputs[4] : normalized(context.known_capabilities);
  return new Set([...inputs[0]].filter(value => inputs.slice(1).every(input => input.has(value)) && known.has(value)));
}
function resolvedLock(facts: DeckRuntimeLockFacts | null, release: DeckPluginReleaseFacts, manifest: DeckPluginManifestDto, input: DeckPluginCompatibilityInput): DeckRuntimePluginLock | null {
  if (!facts || facts.deck_plugin_manifest_hash !== release.manifest_hash) return null;
  const parsed = parseDeckRuntimePluginLock(facts.lock_json); if (!parsed.success) return null;
  const lock = parsed.data;
  if (lock.deck_plugin_id !== input.deck_plugin_id || lock.deck_plugin_version !== input.deck_plugin_version || lock.deck_plugin_manifest_hash !== release.manifest_hash) return null;
  const ids = new Set(lock.claude_code_plugins.map(entry => entry.claude_code_plugin_id));
  if (ids.size !== lock.claude_code_plugins.length || lock.claude_code_plugins.some(entry => stripPythonString(entry.source_ref) === "" || stripPythonString(entry.resolved_version) === "" || !/^sha256:[0-9a-f]{64}$/.test(entry.artifact_digest))) return null;
  const declared = new Set(manifest.runtime.claude_code_plugins.map(plugin => plugin.claude_code_plugin_id));
  return declared.size === ids.size && [...declared].every(id => ids.has(id)) ? lock : null;
}
export function evaluateDeckPluginCompatibility(input: DeckPluginCompatibilityInput, release: DeckPluginReleaseFacts | null, installation: DeckPluginInstallationFacts | null, lockFacts: DeckRuntimeLockFacts | null, context: DeckRuntimeContext): DeckPluginCompatibilityResult {
  if (!release || !installation || !(release.status === "published" || (release.status === "deprecated" && context.deprecated_release_allowed_by_policy)) || installation.status !== "ready" || !storedPluginStringSet(installation.installed_versions_json).has(input.deck_plugin_version)) return failure("release_available");
  const parsed = parseDeckPluginManifest(release.manifest_json);
  if (!parsed.success || parsed.data.deck_plugin_id !== input.deck_plugin_id || parsed.data.deck_plugin_version !== input.deck_plugin_version) return failure("release_available");
  for (const check of ["deck_host_compatible", "claude_agent_compatible", "story_schema_compatible", "deck_runtime_config_compatible"] as const) if (!context[check]) return failure(check);
  if (!resolvedLock(lockFacts, release, parsed.data, input)) return failure("runtime_plugin_resolved");
  const effective = effectivePluginCapabilities(new Set(parsed.data.capabilities), storedPluginStringSet(installation.approved_capabilities_json), context);
  const required = new Set(parsed.data.workflow.steps.flatMap(step => step.required_capabilities));
  for (const plugin of parsed.data.runtime.claude_code_plugins) if (plugin.required) for (const capability of plugin.capability_bindings) required.add(capability);
  if ([...required].some(capability => !effective.has(capability))) return failure("workflow_permission");
  if (parsed.data.runtime.claude_code_plugins.some(plugin => plugin.required && (!context.materialized_runtime_plugin_ids.has(plugin.claude_code_plugin_id) || !context.loadable_runtime_plugin_ids.has(plugin.claude_code_plugin_id)))) return failure("runtime_plugin_ready");
  return deckPluginCompatibilityResultDto.parse({ passed: true, failed_check: null, error_code: null, recovery_action: null, effective_capabilities: [...effective].sort(comparePythonStrings) });
}
export async function resolveDeckRuntimeContext(store: DeckPluginCompatibilityRepository, input: DeckPluginCompatibilityInput) {
  const release = await store.release(input.deck_plugin_id, input.deck_plugin_version), lockFacts = await store.lock(input.deck_plugin_id, input.deck_plugin_version), installation = await store.installation(input.deck_plugin_id, input.workspace_id, false);
  const manifest = parseDeckPluginManifest(release?.manifest_json), lock = parseDeckRuntimePluginLock(lockFacts?.lock_json);
  if (!release || !lockFacts || !installation || !manifest.success || !lock.success) throw new AuthBoundaryError("DECK_PLUGIN_RUNTIME_CONTEXT_INVALID");
  const approved = new Set((await inspectPluginCapabilitySets(installation.approved_capabilities_json)).context_names);
  const materialized = new Set<string>(), loadable = new Set<string>();
  for (const entry of lock.data.claude_code_plugins) {
    const rows = await store.materializations(entry.claude_code_plugin_id, entry.resolved_version, entry.artifact_digest);
    if (rows.some(row => row.materialization_status === "materialized")) materialized.add(entry.claude_code_plugin_id);
    if (rows.some(row => row.materialization_status === "materialized" && ["loadable", "loaded"].includes(row.activation_status))) loadable.add(entry.claude_code_plugin_id);
  }
  const context: DeckRuntimeContext = { ...deckRuntimeCompatibilityPolicy(), deck_runtime_snapshot_policy: approved, user_and_workspace_grants: approved,
    claude_agent_runtime_supported: approved, materialized_runtime_plugin_ids: materialized, loadable_runtime_plugin_ids: loadable,
    deprecated_release_allowed_by_policy: false, known_capabilities: new Set([...manifest.data.capabilities, ...approved]) };
  return { context, release, lockFacts, manifest: manifest.data, lock: lock.data };
}
export async function checkDeckPluginCompatibility(tx: DataTransaction, rawInput: unknown, rawPrincipal: PrincipalDto) {
  const input = deckPluginCompatibilityInputDto.parse(rawInput), principal = principalDto.parse(rawPrincipal);
  if (!principal.scopes.includes("dream:read")) throw new AuthBoundaryError("DREAM_SCOPE_REQUIRED", 403);
  const store = new DeckPluginCompatibilityRepository(tx);
  if (!await store.ownedWorkspace(principal.canonical_user_id, input.workspace_id)) throw new AuthBoundaryError("WORKFLOW_PERMISSION_DENIED", 403);
  const facts = await resolveDeckRuntimeContext(store, input), installation = await store.installation(input.deck_plugin_id, input.workspace_id, true);
  return deckPluginCompatibilityOutputDto.parse({ compatibility: evaluateDeckPluginCompatibility(input, facts.release, installation, facts.lockFacts, facts.context) });
}
