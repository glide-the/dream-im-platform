// [Input] One caller-selected Deck and nullable Voice identifier; actor and prompt mode are server-owned.
// [Output] Closed Deck prompt fields, ordered enabled Voices and ordered enabled plugin provenance.
// [Pos] Registry105 OAuth read DTO; no prompt assembly, plugin bytes, paths or physical selectors.
// [Sync] 2026-09-15: expose only the current Dream DeckChatContext source fields and installation status.
import { z } from "zod";
import { deckPluginRefDto } from "./deckRuntimeDataDto";
import { deckIdInputDto, deckRowDto, deckVoiceRowDto, voiceIdInputDto } from "./deckVoiceDto";

export const deckChatContextInputDto = z.strictObject({
  deck_id: deckIdInputDto.shape.deck_id,
  voice_id: voiceIdInputDto.shape.voice_id.nullable(),
});

export const deckChatContextDeckDto = z.strictObject({
  id: deckRowDto.shape.id,
  name: deckRowDto.shape.name,
  name_zh: deckRowDto.shape.name_zh,
  name_en: deckRowDto.shape.name_en,
  description: deckRowDto.shape.description,
  description_zh: deckRowDto.shape.description_zh,
  description_en: deckRowDto.shape.description_en,
});

export const deckChatContextVoiceDto = z.strictObject({
  id: deckVoiceRowDto.shape.id,
  name: deckVoiceRowDto.shape.name,
  name_zh: deckVoiceRowDto.shape.name_zh,
  name_en: deckVoiceRowDto.shape.name_en,
  system_prompt: deckVoiceRowDto.shape.system_prompt,
});

export const deckChatContextPluginRefDto = z.strictObject({
  plugin_installation_id: deckPluginRefDto.shape.plugin_installation_id,
  package_spec: deckPluginRefDto.shape.package_spec,
  resolved_version: deckPluginRefDto.shape.resolved_version,
  artifact_digest: deckPluginRefDto.shape.artifact_digest,
  order_index: deckPluginRefDto.shape.order_index,
  installation_status: deckPluginRefDto.shape.installation_status,
});

export const deckChatContextOutputDto = z.strictObject({
  deck: deckChatContextDeckDto,
  voices: z.array(deckChatContextVoiceDto),
  plugin_refs: z.array(deckChatContextPluginRefDto),
});

export const deckChatContextOperationContracts = {
  "deck-chat-context.resolve": {
    kind: "read" as const,
    userScope: "dream:read",
    input: deckChatContextInputDto,
    output: deckChatContextOutputDto,
  },
};

export type DeckChatContextInput = z.infer<typeof deckChatContextInputDto>;
export type DeckChatContextOutput = z.infer<typeof deckChatContextOutputDto>;
export type DeckChatContextOperation = keyof typeof deckChatContextOperationContracts;
