// [Input] Closed owner-scoped Deck refs, source-bound installation evidence and Thread memory operations.
// [Output] Strict service DTOs; raw JSON stays text and SQL/actor/table/path selectors are absent.
// [Pos] Admin data contract; Dream keeps artifact verification, CLI compatibility and workspace packing.
// [Sync] 2026-09-15: preserve existing refs order, enabled state, raw memory and exact owner projections.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { stripPythonString } from "./deckPluginManifestDto";
const id = z.string().min(1);
const installationId = z.string().overwrite(stripPythonString).min(1);
// PostgreSQL integer wire range, not a product quota or ordering restriction.
const order = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const deckPluginInstallationDto = z.strictObject({
  id, requested_package_spec: z.string(), package_name: id, marketplace: id, resolved_version: id,
  artifact_digest: digest, claude_cli_version: z.string(), source_type: z.enum(["claude-official", "marketplace", "github", "platform-builtin"]),
  status: z.enum(["installing", "ready", "error", "uninstalled"]),
  manifest_json: z.string().nullable(), component_inventory_json: z.string(), compatibility_json: z.string(),
});
export const deckPluginRefDto = z.strictObject({
  deck_id: id, plugin_installation_id: id, package_spec: z.string(), resolved_version: id, artifact_digest: digest,
  enabled: z.boolean(), order_index: order, created_at: isoTimeDto, updated_at: isoTimeDto,
  installation_status: deckPluginInstallationDto.shape.status, source_type: deckPluginInstallationDto.shape.source_type,
  claude_cli_version: z.string(), manifest_json: z.string().nullable(), component_inventory_json: z.string(),
});
export const deckPluginRuntimeRefDto = deckPluginRefDto.extend({ package_name: id, marketplace: id, installation_compatibility_json: z.string() });
export const pluginRefEvidenceDto = z.strictObject({
  plugin_installation_id: installationId, package_name: id, marketplace: id, resolved_version: id,
  artifact_digest: digest, compatibility_json: z.string(), enabled: z.boolean(), order_index: order,
});
const uniqueIds = <T extends { plugin_installation_id: string }>(values: T[]) => new Set(values.map(value => value.plugin_installation_id)).size === values.length;
export const pluginRefsReplaceInputDto = z.strictObject({ deck_id: id, refs: z.array(pluginRefEvidenceDto).refine(uniqueIds) });
export const pluginRefsPrepareInputDto = z.strictObject({ deck_id: id, installation_ids: z.array(installationId).refine(values => new Set(values).size === values.length) });
export const threadDataInputDto = z.strictObject({ thread_id: id });
export const analysisVoiceDto = z.strictObject({ voice_id: id, name: z.string(), system_prompt: z.string(), icon: z.string().nullable(), color: z.string().nullable() });
export const voiceMemoryOutputDto = z.strictObject({ memory_workspace_config_json: z.string().nullable(), repaired: z.boolean() });
const refsOutput = z.strictObject({ deck_id: id, refs: z.array(deckPluginRefDto) });
export const deckRuntimeDataOperationContracts = {
  "deck-plugin-refs.list": { kind: "read" as const, input: z.strictObject({ deck_id: id }), output: refsOutput, userScope: "dream:read" },
  "deck-plugin-refs.prepare": { kind: "read" as const, input: pluginRefsPrepareInputDto, output: z.strictObject({ installations: z.array(deckPluginInstallationDto) }), userScope: "dream:read" },
  "deck-plugin-refs.runtime-read": { kind: "read" as const, input: threadDataInputDto, output: z.strictObject({ deck_id: id.nullable(), refs: z.array(deckPluginRuntimeRefDto) }), userScope: "dream:read" },
  "deck-plugin-refs.replace": { kind: "write" as const, input: pluginRefsReplaceInputDto, output: refsOutput.extend({ changed: z.boolean() }), userScope: "dream:write" },
  "voice-analysis.list": { kind: "read" as const, input: z.strictObject({}), output: z.strictObject({ voices: z.array(analysisVoiceDto) }), userScope: "dream:read" },
  "voice-memory.resolve": { kind: "write" as const, input: threadDataInputDto, output: voiceMemoryOutputDto, userScope: "dream:write" },
};
export type DeckRuntimeDataOperation = keyof typeof deckRuntimeDataOperationContracts;
export type DeckPluginRefEvidence = z.infer<typeof pluginRefEvidenceDto>;
