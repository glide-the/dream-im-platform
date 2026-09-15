// [Input] Original complete manifest/lock, typed server facts and injected production metadata repository.
// [Output] Fixed failure order, least privilege, Unicode ordering and owned source-query semantics.
// [Pos] Provider-free domain verification; persistent atomicity belongs to public isolated contracts.
// [Sync] 2026-09-15: exercise distinct approved-set parsing and ANY-versus-latest readiness.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compatibilityFixture } from "../../../tests/fixtures/deckPluginCompatibility";
import { deckRuntimeCompatibilityPolicy } from "../../../config/dream-domain-policy";
import { principalDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import { DeckPluginCompatibilityRepository } from "./deckPluginCompatibilityRepository";
import { deckPluginCompatibilityInputDto, deckPluginCompatibilityResultDto } from "./deckPluginCompatibilityDto";
import { checkDeckPluginCompatibility, effectivePluginCapabilities, evaluateDeckPluginCompatibility, resolveDeckRuntimeContext, storedPluginStringSet, type DeckRuntimeContext } from "./deckPluginCompatibilityService";
beforeEach(() => vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000"));
function context(): DeckRuntimeContext { return { deck_host_compatible: true, claude_agent_compatible: true, story_schema_compatible: true, deck_runtime_config_compatible: true,
  deck_runtime_snapshot_policy: new Set(["story.workspace.propose"]), user_and_workspace_grants: new Set(["story.workspace.propose"]), claude_agent_runtime_supported: new Set(["story.workspace.propose"]),
  materialized_runtime_plugin_ids: new Set(["example.runtime"]), loadable_runtime_plugin_ids: new Set(["example.runtime"]), known_capabilities: null, deprecated_release_allowed_by_policy: false }; }
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe("original Plugin compatibility", () => {
  it("passes all original checks without consulting legacy production-ready labels", () => {
    const f = compatibilityFixture(); f.lockFacts.lock_json = JSON.stringify({ ...f.lock, production_ready: false, production_readiness_reasons: ["legacy"] });
    expect(evaluateDeckPluginCompatibility(f.input, f.release, f.installation, f.lockFacts, context())).toEqual({ passed: true, failed_check: null, error_code: null, recovery_action: null, effective_capabilities: ["story.workspace.propose"] });
  });
  it.each(["deck_host_compatible", "claude_agent_compatible", "story_schema_compatible", "deck_runtime_config_compatible"] as const)("retains first-failure order for %s", check => {
    const f = compatibilityFixture(), c = context(); c[check] = false; c.loadable_runtime_plugin_ids.clear();
    const result = evaluateDeckPluginCompatibility(f.input, f.release, f.installation, f.lockFacts, c);
    expect(result.failed_check).toBe(check); expect(result.effective_capabilities).toEqual([]); expect(deckPluginCompatibilityResultDto.safeParse(result).success).toBe(true);
  });
  it.each(["draft", "validating", "revoked", "deprecated"])("denies unavailable %s release before host checks", status => {
    const f = compatibilityFixture(), c = context(); c.deck_host_compatible = false;
    expect(evaluateDeckPluginCompatibility(f.input, { ...f.release, status }, f.installation, f.lockFacts, c)).toMatchObject({ failed_check: "release_available", error_code: "DECK_PLUGIN_UNAVAILABLE" });
  });
  it("requires ready installation and an exact installed version from an all-string array", () => {
    const f = compatibilityFixture();
    for (const patch of [{ status: "disabled" }, { installed_versions_json: '["1.0.0",1]' }, { installed_versions_json: '[" 1.0.0 "]' }, { installed_versions_json: '{}' }]) expect(evaluateDeckPluginCompatibility(f.input, f.release, { ...f.installation, ...patch }, f.lockFacts, context()).failed_check).toBe("release_available");
  });
  it("rejects malformed, duplicate, undeclared and inconsistent immutable locks", () => {
    const f = compatibilityFixture();
    const invalid = [null, { ...f.lock, deck_plugin_manifest_hash: `sha256:${"d".repeat(64)}` }, { ...f.lock, claude_code_plugins: [] }, { ...f.lock, claude_code_plugins: [f.lock.claude_code_plugins[0], f.lock.claude_code_plugins[0]] }, { ...f.lock, claude_code_plugins: [{ ...f.lock.claude_code_plugins[0], artifact_digest: "" }] }];
    for (const raw of invalid) expect(evaluateDeckPluginCompatibility(f.input, f.release, f.installation, { ...f.lockFacts, lock_json: JSON.stringify(raw) }, context()).failed_check).toBe("runtime_plugin_resolved");
  });
  it("denies each absent policy/grant/support/known authority independently", () => {
    const f = compatibilityFixture();
    for (const name of ["deck_runtime_snapshot_policy", "user_and_workspace_grants", "claude_agent_runtime_supported", "known_capabilities"] as const) {
      const c = context(); c[name] = new Set(); expect(evaluateDeckPluginCompatibility(f.input, f.release, f.installation, f.lockFacts, c).failed_check).toBe("workflow_permission");
    }
    expect(evaluateDeckPluginCompatibility(f.input, f.release, { ...f.installation, approved_capabilities_json: '[]' }, f.lockFacts, context()).failed_check).toBe("workflow_permission");
  });
  it("requires both materialized and loadable required plugins", () => {
    const f = compatibilityFixture();
    for (const name of ["materialized_runtime_plugin_ids", "loadable_runtime_plugin_ids"] as const) { const c = context(); c[name].clear(); expect(evaluateDeckPluginCompatibility(f.input, f.release, f.installation, f.lockFacts, c).failed_check).toBe("runtime_plugin_ready"); }
  });
  it("normalizes the five input sets and keeps Python code-point output order", () => {
    const c = context(), names = ["\u{1f600}", "\ue000", "\u001c中文\u001c"];
    c.deck_runtime_snapshot_policy = new Set(names); c.user_and_workspace_grants = new Set(names); c.claude_agent_runtime_supported = new Set(names);
    const effective = effectivePluginCapabilities(new Set(names), new Set(names), c); expect(effective).toEqual(new Set(["😀", "\ue000", "中文"]));
    expect(deckPluginCompatibilityResultDto.safeParse({ passed: true, failed_check: null, error_code: null, recovery_action: null, effective_capabilities: ["中文", "\ue000", "😀"] }).success).toBe(true);
    expect(deckPluginCompatibilityResultDto.safeParse({ passed: true, failed_check: null, error_code: null, recovery_action: null, effective_capabilities: ["中文", "😀", "\ue000"] }).success).toBe(false);
  });
  it("preserves the two original approved JSON parsers and fail-closed explicit flags", () => {
    expect(storedPluginStringSet('[" a ",3,"\u001c b \u001c",""]')).toEqual(new Set());
    expect(storedPluginStringSet('[" a ",3,"\\u001c b \\u001c",""]', true)).toEqual(new Set(["a", "b"]));
    vi.stubEnv("INK_DECK_HOST_COMPATIBLE", "\u001c YeS \u001c"); vi.stubEnv("INK_CLAUDE_AGENT_CONTRACT_COMPATIBLE", "\ufefftrue\ufeff");
    expect(deckRuntimeCompatibilityPolicy()).toEqual({ deck_host_compatible: true, claude_agent_compatible: false, story_schema_compatible: false, deck_runtime_config_compatible: false });
  });
  it("rejects caller-selected readiness, grants and actor fields", () => {
    const f = compatibilityFixture(); for (const field of ["actor", "ready", "approved_capabilities", "runtime_context"]) expect(deckPluginCompatibilityInputDto.safeParse({ ...f.input, [field]: true }).success).toBe(false);
  });
  it("context uses any-status workspace installation and ANY historical ready materialization", async () => {
    const f = compatibilityFixture(), store = new DeckPluginCompatibilityRepository({} as DataTransaction);
    vi.spyOn(store, "release").mockResolvedValue(f.release); vi.spyOn(store, "lock").mockResolvedValue(f.lockFacts);
    const installation = vi.spyOn(store, "installation").mockResolvedValue({ ...f.installation, status: "disabled", approved_capabilities_json: '[" story.workspace.propose ",3]' });
    vi.spyOn(store, "materializations").mockResolvedValue([{ claude_code_plugin_id: "example.runtime", artifact_digest: f.lock.claude_code_plugins[0].artifact_digest, materialized_digest: null, verification_status: null, declaration_status: "disabled", materialization_status: "failed", activation_status: "inactive" }, { claude_code_plugin_id: "example.runtime", artifact_digest: f.lock.claude_code_plugins[0].artifact_digest, materialized_digest: null, verification_status: null, declaration_status: "declared", materialization_status: "materialized", activation_status: "loaded" }]);
    const facts = await resolveDeckRuntimeContext(store, f.input);
    expect(installation).toHaveBeenCalledWith(f.input.deck_plugin_id, f.input.workspace_id, false); expect(facts.context.materialized_runtime_plugin_ids).toEqual(new Set(["example.runtime"])); expect(facts.context.loadable_runtime_plugin_ids).toEqual(new Set(["example.runtime"])); expect(facts.context.deck_runtime_snapshot_policy).toEqual(new Set(["story.workspace.propose"]));
  });
  it("denies a foreign workspace before reading Plugin facts", async () => {
    const f = compatibilityFixture(); const owned = vi.spyOn(DeckPluginCompatibilityRepository.prototype, "ownedWorkspace").mockResolvedValue(null), release = vi.spyOn(DeckPluginCompatibilityRepository.prototype, "release");
    const principal = principalDto.parse({ subject: "subject", canonical_user_id: "1", client_id: "browser", scopes: ["dream:read"], status: "active" });
    await expect(checkDeckPluginCompatibility({} as DataTransaction, f.input, principal)).rejects.toMatchObject({ code: "WORKFLOW_PERMISSION_DENIED", status: 403 }); expect(owned).toHaveBeenCalledWith("1", "workspace"); expect(release).not.toHaveBeenCalled();
  });
});
