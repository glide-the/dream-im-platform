// [Input] Closed owner-scoped Deck/Workspace and Plugin selection identifiers.
// [Output] Strict binding state/history/options/validation/save DTOs matching Dream's public models.
// [Pos] Registry122-126 cross-project contract; actor, SQL, readiness and filesystem paths are absent.
// [Sync] 2026-09-16: define the Deck Plugin binding DTO boundary.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { comparePythonStrings } from "./deckPluginCompatibilityDto";
import { deckPluginManifestDto, stripPydanticString } from "./deckPluginManifestDto";

const identifier = z.string().overwrite(stripPydanticString).min(1);
const revision = z.number().int().nonnegative().safe();
const bindingRevision = revision.positive();
const bindingId = z.string().regex(/^dpb_[0-9a-f]{32}$/);
const pluginId = deckPluginManifestDto.shape.deck_plugin_id;
const pluginVersion = deckPluginManifestDto.shape.deck_plugin_version;
const appliedTo = z.literal("next_run");
const bindingStatus = z.enum(["active", "stale"]);
const selectionCompatibility = z.enum(["passed", "failed", "unknown"]);

export const deckPluginSelectionRecoveryDto = z.strictObject({ owner: identifier, action: identifier });
export const deckPluginSelectionSummaryDto = z.strictObject({
  selectable: z.boolean(),
  release_status: identifier,
  installation_status: identifier,
  compatibility: selectionCompatibility,
  runtime_readiness: identifier,
  reason_code: identifier.nullable(),
  recovery: deckPluginSelectionRecoveryDto.nullable(),
  capability_summary: z.array(z.string()),
}).superRefine((value, context) => {
  if (value.selectable ? value.reason_code !== null || value.recovery !== null : value.reason_code === null || value.recovery === null) {
    context.addIssue({ code: "custom", message: "Selection reason and recovery must match selectable." });
  }
  const ordered = [...new Set(value.capability_summary)].sort(comparePythonStrings);
  if (ordered.length !== value.capability_summary.length || ordered.some((item, index) => item !== value.capability_summary[index])) {
    context.addIssue({ code: "custom", message: "Capability summary must be unique and in Python order." });
  }
});

export const deckPluginBindingResponseDto = z.strictObject({
  deck_plugin_binding_id: bindingId,
  deck_id: identifier,
  deck_plugin_id: pluginId,
  deck_plugin_version: pluginVersion,
  binding_revision: bindingRevision,
  status: bindingStatus,
  applied_to: appliedTo,
  selection_validation_summary: deckPluginSelectionSummaryDto,
});

export const deckPluginBindingStateDto = z.strictObject({
  deck_id: identifier,
  binding_revision: revision,
  applied_to: appliedTo,
  binding: deckPluginBindingResponseDto.nullable(),
}).superRefine((value, context) => {
  if (value.binding !== null && (value.binding.deck_id !== value.deck_id || value.binding.binding_revision !== value.binding_revision)) {
    context.addIssue({ code: "custom", message: "Binding state identity must match its binding." });
  }
});

export const deckPluginBindingHistoryEntryDto = z.strictObject({
  deck_plugin_binding_id: bindingId,
  deck_plugin_id: pluginId,
  deck_plugin_version: pluginVersion,
  binding_revision: bindingRevision,
  status: bindingStatus,
  applied_to: appliedTo,
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
});

export const deckPluginBindingHistoryDto = z.strictObject({
  deck_id: identifier,
  current_binding_revision: revision,
  entries: z.array(deckPluginBindingHistoryEntryDto),
});

export const deckPluginOptionDto = z.strictObject({
  display_name: z.string(),
  deck_plugin_id: pluginId,
  deck_plugin_version: pluginVersion,
  release_status: identifier,
  installation_status: identifier,
  compatibility: selectionCompatibility,
  runtime_readiness: identifier,
  selectable: z.boolean(),
  reason_code: identifier.nullable(),
  recovery: deckPluginSelectionRecoveryDto.nullable(),
  capability_summary: z.array(z.string()),
});

export const deckPluginOptionsDto = z.strictObject({
  deck_id: identifier,
  applied_to: appliedTo,
  options: z.array(deckPluginOptionDto),
});

const scopeInput = { deck_id: identifier, workspace_id: identifier };
export const deckPluginBindingScopeInputDto = z.strictObject(scopeInput);
export const deckPluginBindingHistoryInputDto = z.strictObject({ ...scopeInput, limit: z.number().int().min(1).max(100) });
export const deckPluginBindingSelectionInputDto = z.strictObject({
  ...scopeInput,
  deck_plugin_id: pluginId,
  deck_plugin_version: pluginVersion,
  apply_to: appliedTo,
});
export const deckPluginBindingSaveInputDto = deckPluginBindingSelectionInputDto.extend({ expected_binding_revision: revision });
export const deckPluginBindingValidationDto = z.strictObject({
  deck_id: identifier,
  deck_plugin_id: pluginId,
  deck_plugin_version: pluginVersion,
  applied_to: appliedTo,
  validation: deckPluginSelectionSummaryDto,
});

export const deckPluginBindingOperationContracts = {
  "deck-plugin-binding.current": { kind: "read" as const, userScope: "dream:read", input: deckPluginBindingScopeInputDto, output: deckPluginBindingStateDto },
  "deck-plugin-binding.history": { kind: "read" as const, userScope: "dream:read", input: deckPluginBindingHistoryInputDto, output: deckPluginBindingHistoryDto },
  "deck-plugin-binding.options": { kind: "read" as const, userScope: "dream:read", input: deckPluginBindingScopeInputDto, output: deckPluginOptionsDto },
  "deck-plugin-binding.validate": { kind: "read" as const, userScope: "dream:read", input: deckPluginBindingSelectionInputDto, output: deckPluginBindingValidationDto },
  "deck-plugin-binding.save": { kind: "write" as const, userScope: "dream:write", input: deckPluginBindingSaveInputDto, output: deckPluginBindingResponseDto },
};

export type DeckPluginBindingOperation = keyof typeof deckPluginBindingOperationContracts;
export type DeckPluginBindingScopeInput = z.infer<typeof deckPluginBindingScopeInputDto>;
export type DeckPluginBindingSelectionInput = z.infer<typeof deckPluginBindingSelectionInputDto>;
export type DeckPluginBindingSaveInput = z.infer<typeof deckPluginBindingSaveInputDto>;
export type DeckPluginSelectionSummary = z.infer<typeof deckPluginSelectionSummaryDto>;
