// [Input] Original required-entry/smoke receipts, raw capability JSON and a dependency-owned transaction.
// [Output] Integrity/drift/permission/order evidence with original numeric and nonfinite semantics.
// [Pos] Provider-free checks; no fixture SQL, Runtime execution or synthetic lifecycle state machine.
// [Sync] 2026-09-15: cover exact declaration/digest/smoke rules and separate legacy capability parsers.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DataTransaction } from "./database";
import { preflightBindingReleaseDto, verifyPreflightMaterialization, type PreflightMaterialization } from "./workflowPreflightDependencies";
import { WorkflowPreflightDependencyService } from "./workflowPreflightDependencyService";
import { inspectPluginCapabilitySets } from "./deckContentCanonical";
const digest = `sha256:${"a".repeat(64)}`;
const binding = preflightBindingReleaseDto.parse({ deck_plugin_id: "example.story", deck_plugin_version: "1.0.0", runtime_plugin_lock_id: "lock", deck_runtime_profile_id: "profile", deck_runtime_snapshot_contract: "snapshot/v1", manifest_hash: digest,
  workflow_definition_ref: "workflow", input_schema_ref: "schema://input", output_schema_ref: "story-workspace/output", required_runtime_plugins: [{ claude_code_plugin_id: "plugin", artifact_digest: digest }] });
function materialization(): PreflightMaterialization { return { runtime_plugin_lock_id: "lock", load_smoke_passed: true, plugins: [{ claude_code_plugin_id: "plugin", artifact_digest: digest, declaration_status: "declared", materialization_status: "materialized", activation_status: "loaded" }] }; }
beforeEach(() => vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "5000"));
afterEach(() => vi.unstubAllEnvs());
describe("original Preflight dependency checks", () => {
  it("accepts exact required plugin and load-smoke proof", () => expect(verifyPreflightMaterialization(binding, materialization())).toBeUndefined());
  it("rejects drift, duplicate and missing required plugin in original order", () => {
    expect(() => verifyPreflightMaterialization(binding, { ...materialization(), runtime_plugin_lock_id: "other" })).toThrow("CONFIG_VERSION_DRIFT");
    expect(() => verifyPreflightMaterialization(binding, { ...materialization(), plugins: [...materialization().plugins, ...materialization().plugins] })).toThrow("RUNTIME_PLUGIN_NOT_READY");
    expect(() => verifyPreflightMaterialization(binding, { ...materialization(), plugins: [] })).toThrow("RUNTIME_PLUGIN_NOT_READY");
  });
  it("distinguishes required digest corruption from declaration/materialization/activation failure", () => {
    const result = materialization(); result.plugins[0].artifact_digest = `sha256:${"b".repeat(64)}`;
    expect(() => verifyPreflightMaterialization(binding, result)).toThrow("DECK_PLUGIN_INTEGRITY_FAILED");
    for (const patch of [{ declaration_status: "disabled" as const }, { materialization_status: "failed" as const }, { activation_status: "inactive" as const }]) expect(() => verifyPreflightMaterialization(binding, { ...materialization(), plugins: [{ ...materialization().plugins[0], ...patch }] })).toThrow("RUNTIME_PLUGIN_NOT_READY");
  });
  it("requires global smoke even with no required entries", () => expect(() => verifyPreflightMaterialization({ ...binding, required_runtime_plugins: [] }, { ...materialization(), load_smoke_passed: false })).toThrow("RUNTIME_PLUGIN_LOAD_FAILED"));
  it("preserves three original capability parsers with nonfinite, unhashable, dictionary and string inputs", async () => {
    expect(await inspectPluginCapabilitySets('[" a ",NaN,Infinity,"\\u001c b \\u001c"]')).toEqual({ context_names: ["a", "b"], approved_names: [], preflight_names: ["\u001c b \u001c", " a "] });
    expect(await inspectPluginCapabilitySets('["a",{}]')).toEqual({ context_names: ["a"], approved_names: [], preflight_names: [] });
    expect(await inspectPluginCapabilitySets('{"a":1,"b":2}')).toEqual({ context_names: [], approved_names: [], preflight_names: ["a", "b"] });
    expect(await inspectPluginCapabilitySets('"中文"')).toEqual({ context_names: [], approved_names: [], preflight_names: ["中", "文"] });
  });
  it("checks canonical input byte capacity and existing output schema families", async () => {
    const service = new WorkflowPreflightDependencyService({} as DataTransaction, "1", "workspace");
    expect(await service.manifest(binding, '{"big":9007199254740993,"float":1.0}')).toBe(true);
    await expect(service.manifest({ ...binding, output_schema_ref: "unrelated/output" }, '{}')).rejects.toMatchObject({ code: "STORY_SCHEMA_INCOMPATIBLE" });
    vi.stubEnv("DREAM_PREFLIGHT_MAX_INPUT_BYTES", "8"); await expect(service.manifest(binding, '{"中文":"😀"}')).rejects.toMatchObject({ code: "DECK_PLUGIN_MANIFEST_INVALID" });
    vi.stubEnv("DREAM_PREFLIGHT_MAX_INPUT_BYTES", "0"); await expect(service.manifest(binding, '{}')).rejects.toMatchObject({ code: "WORKFLOW_PREFLIGHT_POLICY_INVALID" });
  });
});
