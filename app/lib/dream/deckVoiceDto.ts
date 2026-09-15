// [Input] Closed Deck/Voice and content-version business operations, separate from physical ORM entities.
// [Output] Strict candidate wire schemas, exact decimal identity, nullable legacy fields and revision/CAS state.
// [Pos] Primary-owned domain DTO; operations are advertised only after Repository/Service/public contracts exist.
// [Sync] 2026-09-14: migrate the actual voices.py/content_versioning.py aggregate without user-id/table selectors.
import { z } from "zod";
import { decimalIdDto, isoTimeDto } from "../auth/dto";
const id = z.string().min(1);
const text = z.string().nullable();
const integer = z.number().int().safe();
const positive = integer.positive();
const nonnegative = integer.nonnegative();
const memoryJsonInput = z.string().refine(value => { try { const decoded: unknown = JSON.parse(value); return !!decoded && typeof decoded === "object" && !Array.isArray(decoded); } catch { return false; } }).meta({ contentMediaType: "application/json", contentSchema: { type: "object" } });
const localizedFields = { name: z.string(), name_zh: text, name_en: text, description: text, description_zh: text, description_en: text, icon: text, color: text };
export const deckVersionStateDto = z.strictObject({ deck_id: id, draft_revision: positive, latest_version: positive.nullable(), published_draft_revision: nonnegative, dirty: z.boolean(), status: z.enum(["unpublished", "draft", "published"]), next_version: positive });
export const deckVoiceRowDto = z.strictObject({ id, deck_id: id, name: z.string(), name_zh: text, name_en: text, system_prompt: z.string(), icon: text, color: text, is_system: z.boolean().nullable(), parent_id: text, owner_id: decimalIdDto.nullable(), enabled: z.boolean().nullable(), has_local_changes: z.boolean().nullable(), order_index: integer.nullable(), created_at: isoTimeDto.nullable(), updated_at: isoTimeDto.nullable(), thread_id: text, memory_workspace_config_json: z.string().nullable() });
export const deckRowDto = z.strictObject({ id, ...localizedFields, is_system: z.boolean().nullable(), parent_id: text, owner_id: decimalIdDto.nullable(), enabled: z.boolean().nullable(), has_local_changes: z.boolean().nullable(), order_index: integer.nullable(), published: z.boolean().nullable(), author_name: text, install_count: integer.nullable(), draft_revision: positive, latest_version: nonnegative, published_draft_revision: nonnegative, created_at: isoTimeDto.nullable(), updated_at: isoTimeDto.nullable() });
const deckPolicyFields = { agent_type: z.enum(["chat", "dream"]), agent_type_revision: nonnegative, deck_plugin_id: text, deck_plugin_version: text, can_publish: z.boolean(), publish_block_reason: z.literal("default_initialized").nullable(), deck_version_capability: z.literal(true), deck_version: positive.nullable(), deck_version_dirty: z.boolean(), deck_version_status: z.enum(["unpublished", "draft", "published"]), next_deck_version: positive };
export const deckListItemDto = deckRowDto.extend({ ...deckPolicyFields, voice_count: nonnegative, total_voice_count: nonnegative.nullable(), author_display_name: text });
export const deckDetailDto = deckRowDto.extend({ ...deckPolicyFields, voices: z.array(deckVoiceRowDto) });
export const deckIdInputDto = z.strictObject({ deck_id: id });
export const deckListInputDto = z.strictObject({ community: z.boolean() });
// This evidence is constructed by Dream's server filesystem verifier, never copied from browser fields.
// The Admin service must independently match its configured default and locked installation row.
export const deckDefaultPluginEvidenceDto = z.strictObject({ plugin_installation_id: id, package_name: id, resolved_version: id, artifact_digest: z.string().regex(/^sha256:[0-9a-f]{64}$/) });
export const deckCreateInputDto = z.strictObject({ ...localizedFields, order_index: integer.nullable(), default_plugin_evidence: deckDefaultPluginEvidenceDto });
export const deckUpdateFieldsDto = z.strictObject({ name: z.string().optional(), name_zh: text.optional(), name_en: text.optional(), description: text.optional(), description_zh: text.optional(), description_en: text.optional(), icon: text.optional(), color: text.optional(), enabled: z.boolean().optional(), order_index: integer.nullable().optional() });
export const deckUpdateInputDto = z.strictObject({ deck_id: id, updates: deckUpdateFieldsDto });
export const voiceCreateInputDto = z.strictObject({ deck_id: id, name: z.string(), system_prompt: z.string(), name_zh: text, name_en: text, icon: text, color: text, memory_workspace_config_json: memoryJsonInput.nullable(), order_index: integer.nullable() });
export const voiceUpdateFieldsDto = z.strictObject({ name: z.string().optional(), system_prompt: z.string().optional(), name_zh: text.optional(), name_en: text.optional(), icon: text.optional(), color: text.optional(), enabled: z.boolean().optional(), order_index: integer.nullable().optional(), thread_id: text.optional(), memory_workspace_config_json: memoryJsonInput.nullable().optional() });
export const voiceUpdateInputDto = z.strictObject({ voice_id: id, updates: voiceUpdateFieldsDto });
export const voiceIdInputDto = z.strictObject({ voice_id: id });
export const voiceForkInputDto = z.strictObject({ voice_id: id, target_deck_id: id });
export const deckVersionMutationInputDto = z.strictObject({ deck_id: id, expected_draft_revision: positive, expected_base_version: positive.nullable() });
export const deckVersionCommitInputDto = deckVersionMutationInputDto.extend({ description: z.string().refine(value => [...value].length <= 200).meta({ maxLength: 200 }).nullable() });
export const deckVersionHistoryInputDto = z.strictObject({ deck_id: id, limit: integer.min(1).max(100) });
export const deckVersionDetailInputDto = z.strictObject({ deck_id: id, version: positive });
export const deckVersionChangeDto = z.strictObject({ scope: z.enum(["deck", "agent_type", "agents", "claude_plugins", "runtime_binding"]), change_type: z.enum(["added", "removed", "modified"]), label: z.string(), fields: z.array(z.string()) });
export const deckVersionSummaryDto = z.strictObject({ version: positive, base_version: positive.nullable(), source_draft_revision: positive, description: text, content_hash: z.string().regex(/^sha256:[0-9a-f]{64}$/), created_by: decimalIdDto, created_at: isoTimeDto, runtime_plugin_version: text });
export const deckVersionPreviewDto = deckVersionStateDto.extend({ target_version: positive, changes: z.array(deckVersionChangeDto), impact: z.array(z.string()) });
export const deckVersionCommitDto = z.strictObject({ deck_id: id, version: deckVersionSummaryDto, state: deckVersionStateDto });
export const deckVersionHistoryDto = z.strictObject({ deck_id: id, current: deckVersionStateDto, versions: z.array(deckVersionSummaryDto) });

export const deckContentSnapshotDto = z.strictObject({
 schema_version: z.literal("deck-content/v1"),
 deck: z.strictObject({ id, ...localizedFields, enabled: z.boolean().nullable(), order_index: integer.nullable() }),
 agent_type: z.enum(["chat","dream"]),
 agents: z.array(z.strictObject({ id,name:z.string(),name_zh:text,name_en:text,system_prompt:z.string(),icon:text,color:text,enabled:z.boolean(),order_index:integer.nullable(),memory_workspace_config:z.json() })),
 claude_plugins: z.array(z.strictObject({plugin_installation_id:id,package_spec:id,resolved_version:id,artifact_digest:z.string(),enabled:z.boolean(),order_index:integer})),
 runtime_binding: z.strictObject({deck_plugin_id:id,deck_plugin_version:id,binding_revision:positive}).nullable(),
});
const snapshotJsonDto = z.string().refine(value => { try { return deckContentSnapshotDto.safeParse(JSON.parse(value)).success; } catch { return false; } }).meta({ contentMediaType:"application/json" });

export const deckVersionDetailDto = deckVersionSummaryDto.extend({ deck_id: id, snapshot_json: snapshotJsonDto });
export type DeckVersionStateDto = z.infer<typeof deckVersionStateDto>;
export type DeckRowDto = z.infer<typeof deckRowDto>;
export type DeckVoiceRowDto = z.infer<typeof deckVoiceRowDto>;
export type DeckUpdateInputDto = z.infer<typeof deckUpdateInputDto>;
export type VoiceUpdateInputDto = z.infer<typeof voiceUpdateInputDto>;

// Closed raw JSON preserves numeric lexemes until Python decodes the legacy v1 contract.
// Dream alone projects the response JSON string back to its existing public dict field.
export const deckVoicePolicyDto = z.strictObject({ default_system_deck_id: id, retired_system_deck_ids: z.array(id), default_plugin_package_name: id, default_plugin_version: id, default_memory_workspace_config_json: memoryJsonInput, template: z.strictObject({ ...localizedFields, voices: z.array(z.strictObject({ name: z.string(), name_zh: text, name_en: text, system_prompt: z.string(), icon: text, color: text })) }) });
export type DeckVoicePolicyDto = z.infer<typeof deckVoicePolicyDto>;
const changed = z.strictObject({ changed: z.boolean() });
const deckCreated = z.strictObject({ deck_id: id });
const voiceCreated = z.strictObject({ voice_id: id });
const contract = <I extends z.ZodType,O extends z.ZodType>(kind: "read"|"mutation", input:I, output:O) => ({kind,input,output});
export const deckVoiceOperationContracts = {
  "deck.list": contract("read",deckListInputDto,z.strictObject({decks:z.array(deckListItemDto)})),
  "deck.detail": contract("read",deckIdInputDto,z.strictObject({deck:deckDetailDto.nullable()})),
  "deck.create": contract("mutation",deckCreateInputDto,deckCreated),
  "deck.update": contract("mutation",deckUpdateInputDto,changed),
  "deck.delete": contract("mutation",deckIdInputDto,changed),
  "deck.toggle-publication": contract("mutation",deckIdInputDto,z.strictObject({published:z.boolean()})),
  "deck.collect": contract("mutation",deckIdInputDto,deckCreated),
  "deck.sync-parent": contract("mutation",deckIdInputDto,z.strictObject({success:z.literal(true),synced_voices:nonnegative})),
  "deck.reconcile-default": contract("mutation",z.strictObject({default_plugin_evidence:deckDefaultPluginEvidenceDto}),z.strictObject({deck_id:id,reconciled:z.boolean(),reason:z.enum(["default_created","refs_preserved","missing_ref"])})),
  "deck.provision-default": contract("mutation",z.strictObject({default_plugin_evidence:deckDefaultPluginEvidenceDto}),deckCreated),
  "voice.create": contract("mutation",voiceCreateInputDto,voiceCreated),
  "voice.update": contract("mutation",voiceUpdateInputDto,changed),
  "voice.delete": contract("mutation",voiceIdInputDto,changed),
  "voice.collect": contract("mutation",voiceForkInputDto,voiceCreated),
  "deck-content.state": contract("read",deckIdInputDto,deckVersionStateDto),
  "deck-content.preview": contract("read",deckVersionMutationInputDto,deckVersionPreviewDto),
  "deck-content.commit": contract("mutation",deckVersionCommitInputDto,deckVersionCommitDto),
  "deck-content.history": contract("read",deckVersionHistoryInputDto,deckVersionHistoryDto),
  "deck-content.detail": contract("read",deckVersionDetailInputDto,deckVersionDetailDto),
} as const;
export type DeckVoiceOperation = keyof typeof deckVoiceOperationContracts;
