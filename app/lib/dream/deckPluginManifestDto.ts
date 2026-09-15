// [Input] Actual Dream DeckPluginManifestV1 release JSON and its nested strict Python contracts.
// [Output] Reusable complete manifest validation and fail-closed Agent-type projection.
// [Pos] Shared Admin domain schema; does not implement Runtime compatibility or artifact loading.
// [Sync] 2026-09-15: distinguish Pydantic Unicode White_Space normalization from explicit Python str.strip.
import { z } from "zod";
// Explicit Python str.strip includes U+001C..001F; Pydantic string normalization does not.
const pythonWhitespace = /^[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/gu;
export const stripPythonString = (value:string) => value.replace(pythonWhitespace, "");
export const stripPydanticString = (value:string) => value.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "");
const string = z.string().overwrite(stripPydanticString);
const nonempty = string.min(1);
const strings = z.array(string);
const semver = /^(?:0|[1-9]\p{Decimal_Number}*)\.(?:0|[1-9]\p{Decimal_Number}*)\.(?:0|[1-9]\p{Decimal_Number}*)(?:-(?:0|[1-9]\p{Decimal_Number}*|\p{Decimal_Number}*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\p{Decimal_Number}*|\p{Decimal_Number}*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const stableId = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
// Pydantic's persisted manifest bool field accepts these exact conventional encodings.
const pythonBoolean = z.preprocess(value => {
  if (value === 0 || value === 1) return Boolean(value);
  if (typeof value === "string") { const v = value.toLowerCase(); if (["0", "off", "f", "false", "n", "no"].includes(v)) return false; if (["1", "on", "t", "true", "y", "yes"].includes(v)) return true; }
  return value;
}, z.boolean());
const workflowStep = z.strictObject({ step_id: nonempty, required_capabilities: strings.default([]) });
const workflow = z.strictObject({ workflow_definition_ref: nonempty, input_schema_ref: nonempty, output_schema_ref: nonempty, steps: z.array(workflowStep).min(1) });
const compatibility = z.strictObject({ deck_host_api: nonempty, claude_agent_contract: nonempty, claude_code: nonempty, story_output_schema: nonempty, deck_runtime_snapshot_contract: nonempty });
const configuration = z.strictObject({ profile_contract: nonempty, required_config_keys: strings, secret_ref_kinds: strings, allow_profile_versions: nonempty });
const plugin = z.strictObject({ claude_code_plugin_id: nonempty, source_ref: nonempty, version_constraint: nonempty, required: pythonBoolean, capability_bindings: strings.default([]) });
export const deckPluginManifestDto = z.strictObject({
  schema_version: z.literal("deck-plugin/v1"), deck_plugin_id: string.min(3).regex(stableId), deck_plugin_version: string.min(5).regex(semver),
  display_name: nonempty, description: nonempty, author: nonempty, status: z.enum(["draft", "validating", "published", "deprecated", "revoked"]),
  workflow, compatibility, runtime_configuration: configuration, capabilities: strings.min(1).refine(values => values.every(value => stripPythonString(value) !== "") && new Set(values).size === values.length),
  runtime: z.strictObject({ claude_code_plugins: z.array(plugin), degraded_modes: strings.default([]) }), dependencies: z.strictObject({ deck_plugin_releases: strings.default([]) }),
});
export type DeckPluginManifestDto = z.infer<typeof deckPluginManifestDto>;
export function parseDeckPluginManifest(raw: unknown) {
  try { return deckPluginManifestDto.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw); } catch { return deckPluginManifestDto.safeParse(null); }
}
export function agentTypeFromManifest(raw: unknown): "chat" | "dream" {
  const parsed = parseDeckPluginManifest(raw);
  return parsed.success && parsed.data.capabilities.includes("story.workspace.propose") ? "dream" : "chat";
}
