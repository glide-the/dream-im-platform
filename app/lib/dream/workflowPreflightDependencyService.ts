// [Input] Verified owner/workspace and stored Plugin facts in a stage-owned Admin transaction.
// [Output] The original fixed authoritative Preflight checks and narrow sanitized dependency receipts.
// [Pos] Shared Story/Workflow dependency composition; does not decide or commit Preflight lifecycle stages.
// [Sync] 2026-09-15: preserve original schema/capability/materialization failures and owner-first metadata access.
import { preflightInputCapacity } from "../../../config/dream-domain-policy";
import type { DataTransaction } from "./database";
import { WorkflowPreflightDependencyRepository } from "./workflowPreflightDependencyRepository";
import { DeckPluginCompatibilityRepository } from "./deckPluginCompatibilityRepository";
import { evaluateDeckPluginCompatibility, resolveDeckRuntimeContext } from "./deckPluginCompatibilityService";
import { parseDeckPluginManifest } from "./deckPluginManifestDto";
import { canonicalBusinessJson, inspectPluginCapabilitySets } from "./deckContentCanonical";
import { verifyPreflightMaterialization, WorkflowPreflightCheckError, type PreflightBindingRelease } from "./workflowPreflightDependencies";
export class WorkflowPreflightDependencyService {
  private readonly repository: WorkflowPreflightDependencyRepository;
  private readonly plugins: DeckPluginCompatibilityRepository;
  constructor(tx: DataTransaction, canonicalUserId: string, private readonly workspaceId: string) {
    this.repository = new WorkflowPreflightDependencyRepository(tx, canonicalUserId, workspaceId);
    this.plugins = new DeckPluginCompatibilityRepository(tx);
  }
  identity(deckId: string) { return this.repository.identity(deckId); }
  binding(deckId: string, revision: number) { return this.repository.binding(deckId, revision); }
  async manifest(binding: PreflightBindingRelease, rawInputJson: string) {
    const canonical = await canonicalBusinessJson(rawInputJson);
    if (Buffer.byteLength(canonical.canonical_json, "utf8") > preflightInputCapacity()) throw new WorkflowPreflightCheckError("DECK_PLUGIN_MANIFEST_INVALID");
    if (!binding.output_schema_ref.startsWith("story-workspace/") && !binding.output_schema_ref.startsWith("schema://")) throw new WorkflowPreflightCheckError("STORY_SCHEMA_INCOMPATIBLE");
    return true;
  }
  async compatibility(binding: PreflightBindingRelease) {
    const input = { workspace_id: this.workspaceId, deck_plugin_id: binding.deck_plugin_id, deck_plugin_version: binding.deck_plugin_version };
    const facts = await resolveDeckRuntimeContext(this.plugins, input), installation = await this.plugins.installation(binding.deck_plugin_id, this.workspaceId, true);
    if (!installation) throw new WorkflowPreflightCheckError("DECK_PLUGIN_UNAVAILABLE");
    const result = evaluateDeckPluginCompatibility(input, facts.release, installation, facts.lockFacts, facts.context);
    if (!result.passed) throw new WorkflowPreflightCheckError(result.error_code ?? "CLAUDE_AGENT_INCOMPATIBLE");
    return true;
  }
  async capabilities(binding: PreflightBindingRelease) {
    const installation = await this.plugins.installation(binding.deck_plugin_id, this.workspaceId, true);
    const approved = new Set((await inspectPluginCapabilitySets(installation?.approved_capabilities_json ?? null)).preflight_names);
    const release = await this.plugins.release(binding.deck_plugin_id, binding.deck_plugin_version), manifest = parseDeckPluginManifest(release?.manifest_json);
    if (!manifest.success) throw new Error("Invalid stored manifest metadata.");
    const required = new Set(manifest.data.workflow.steps.flatMap(step => step.required_capabilities));
    if ([...required].some(capability => !approved.has(capability))) throw new WorkflowPreflightCheckError("WORKFLOW_PERMISSION_DENIED");
    return true;
  }
  snapshot(deckId: string, binding: PreflightBindingRelease) { return this.repository.snapshot(deckId, binding.deck_runtime_profile_id, binding.deck_runtime_snapshot_contract); }
  async materialization(binding: PreflightBindingRelease) {
    const receipt = await this.repository.materialization(binding.runtime_plugin_lock_id);
    verifyPreflightMaterialization(binding, receipt);
    return receipt;
  }
}
