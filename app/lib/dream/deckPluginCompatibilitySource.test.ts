// [Input] Actual original eight-check service with injected fixed read results and typed server context.
// [Output] Complete first-failure/action/capability source parity, including explicit Python blank checks.
// [Pos] Provider-free read-only source oracle; original SQL is never interpreted or connected.
// [Sync] 2026-09-15: preserve control-whitespace lock rejection separately from Pydantic normalization.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { compatibilityFixture } from "../../../tests/fixtures/deckPluginCompatibility";
import { evaluateDeckPluginCompatibility, type DeckRuntimeContext } from "./deckPluginCompatibilityService";
function fixture() {
  return { ...compatibilityFixture(), context: { deck_host_compatible: true, claude_agent_compatible: true, story_schema_compatible: true, deck_runtime_config_compatible: true,
    deck_runtime_snapshot_policy: ["story.workspace.propose"], user_and_workspace_grants: ["story.workspace.propose"], claude_agent_runtime_supported: ["story.workspace.propose"],
    materialized_runtime_plugin_ids: ["example.runtime"], loadable_runtime_plugin_ids: ["example.runtime"], known_capabilities: null as string[] | null, deprecated_release_allowed_by_policy: false } };
}
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches the actual original complete compatibility chain", () => {
  const cases = [fixture()];
  for (const key of ["deck_host_compatible", "claude_agent_compatible", "story_schema_compatible", "deck_runtime_config_compatible"] as const) { const f = fixture(); f.context[key] = false; cases.push(f); }
  for (const status of ["draft", "revoked", "deprecated"]) { const f = fixture(); f.release.status = status; cases.push(f); }
  for (const raw of ['[]', '["story.workspace.propose",1]', '[" story.workspace.propose "]']) { const f = fixture(); f.installation.approved_capabilities_json = raw; cases.push(f); }
  const missingVersion = fixture(); missingVersion.installation.installed_versions_json = '[" 1.0.0 "]'; cases.push(missingVersion);
  const missingPlugin = fixture(); missingPlugin.context.loadable_runtime_plugin_ids = []; cases.push(missingPlugin);
  const duplicate = fixture(); duplicate.lock.claude_code_plugins.push({ ...duplicate.lock.claude_code_plugins[0] }); duplicate.lockFacts.lock_json = JSON.stringify(duplicate.lock); cases.push(duplicate);
  for (const source_ref of ["\u001c", "\u001d", "\u001e", "\u001f"]) {
    const f = fixture(); f.lock.claude_code_plugins[0].source_ref = source_ref; f.lockFacts.lock_json = JSON.stringify(f.lock); cases.push(f);
  }
  const deprecated = fixture(); deprecated.release.status = "deprecated"; deprecated.context.deprecated_release_allowed_by_policy = true; cases.push(deprecated);
  const oracle = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/deckPluginMetadataOracle.py")], {
    input: JSON.stringify({ action: "compatibility", cases: cases.map(f => ({ input: f.input, release: f.release, installation: f.installation, lock_facts: f.lockFacts, context: f.context })) }), env: process.env, encoding: "utf8", timeout: 10_000 });
  expect(oracle.status, "Original compatibility source oracle must launch").toBe(0);
  const results = JSON.parse(oracle.stdout) as unknown[]; expect(results.length).toBe(cases.length);
  cases.forEach((f, i) => {
    const context: DeckRuntimeContext = { ...f.context,
      deck_runtime_snapshot_policy: new Set(f.context.deck_runtime_snapshot_policy), user_and_workspace_grants: new Set(f.context.user_and_workspace_grants),
      claude_agent_runtime_supported: new Set(f.context.claude_agent_runtime_supported), materialized_runtime_plugin_ids: new Set(f.context.materialized_runtime_plugin_ids),
      loadable_runtime_plugin_ids: new Set(f.context.loadable_runtime_plugin_ids),
      known_capabilities: f.context.known_capabilities === null ? null : new Set(f.context.known_capabilities) };
    expect(evaluateDeckPluginCompatibility(f.input, f.release, f.installation, f.lockFacts, context), `actual compatibility case ${i}`).toEqual(results[i]);
  });
});
