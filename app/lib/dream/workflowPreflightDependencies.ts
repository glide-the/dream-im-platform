// [Input] Owned binding/release/lock and exact original snapshot/materialization metadata.
// [Output] Narrow authoritative Preflight receipts and safe first-failure errors.
// [Pos] Reusable business check contracts; no DB selectors, Runtime calls or client readiness flags.
// [Sync] 2026-09-15: port original BindingReleaseContext and required-entry/smoke rules.
import { z } from "zod";
import { AuthBoundaryError } from "../auth/config";
import { stripPydanticString } from "./deckPluginManifestDto";
const text = z.string().overwrite(stripPydanticString).min(1);
const digest = z.string().overwrite(stripPydanticString).regex(/^sha256:[0-9a-f]{64}$/);
export const preflightBindingReleaseDto = z.strictObject({ deck_plugin_id: text, deck_plugin_version: text, runtime_plugin_lock_id: text,
  deck_runtime_profile_id: text, deck_runtime_snapshot_contract: text, manifest_hash: digest, workflow_definition_ref: text,
  input_schema_ref: text, output_schema_ref: text, required_runtime_plugins: z.array(z.strictObject({ claude_code_plugin_id: text, artifact_digest: digest })).default([]) });
export const preflightSnapshotReceiptDto = z.strictObject({ deck_runtime_snapshot_id: text, sanitized_summary_hash: digest, reused: z.boolean().default(false) });
export const preflightMaterializationDto = z.strictObject({ runtime_plugin_lock_id: text, plugins: z.array(z.strictObject({ claude_code_plugin_id: text,
  declaration_status: z.enum(["undeclared", "declared", "disabled"]), materialization_status: z.enum(["missing", "materializing", "materialized", "failed"]),
  activation_status: z.enum(["inactive", "loadable", "loaded", "load_failed"]), artifact_digest: digest })).default([]), load_smoke_passed: z.boolean() });
export type PreflightBindingRelease = z.infer<typeof preflightBindingReleaseDto>;
export type PreflightSnapshotReceipt = z.infer<typeof preflightSnapshotReceiptDto>;
export type PreflightMaterialization = z.infer<typeof preflightMaterializationDto>;
export class WorkflowPreflightCheckError extends AuthBoundaryError {
  constructor(code: string) { super(code, 409); }
}
export function verifyPreflightMaterialization(binding: PreflightBindingRelease, result: PreflightMaterialization) {
  if (result.runtime_plugin_lock_id !== binding.runtime_plugin_lock_id) throw new WorkflowPreflightCheckError("CONFIG_VERSION_DRIFT");
  const plugins = new Map(result.plugins.map(plugin => [plugin.claude_code_plugin_id, plugin]));
  if (plugins.size !== result.plugins.length) throw new WorkflowPreflightCheckError("RUNTIME_PLUGIN_NOT_READY");
  for (const required of binding.required_runtime_plugins) {
    const actual = plugins.get(required.claude_code_plugin_id);
    if (!actual) throw new WorkflowPreflightCheckError("RUNTIME_PLUGIN_NOT_READY");
    if (actual.artifact_digest !== required.artifact_digest) throw new WorkflowPreflightCheckError("DECK_PLUGIN_INTEGRITY_FAILED");
    if (actual.declaration_status !== "declared" || actual.materialization_status !== "materialized" || !["loadable", "loaded"].includes(actual.activation_status)) throw new WorkflowPreflightCheckError("RUNTIME_PLUGIN_NOT_READY");
  }
  if (!result.load_smoke_passed) throw new WorkflowPreflightCheckError("RUNTIME_PLUGIN_LOAD_FAILED");
}
