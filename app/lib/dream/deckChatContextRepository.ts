// [Input] Validated canonical actor, Deck/Voice selection and caller-owned Admin data UOW.
// [Output] Owned Deck, selected/all Voice and plugin-ref storage facts with deterministic ordering.
// [Pos] Registry105 typed Drizzle read; Dream owns enabled/ready policy, prompt, Runtime and workspace packing.
// [Sync] 2026-09-15: retain permission filtering while returning status fields for Dream decisions.
import { and, asc, eq, sql } from "drizzle-orm";
import {
  claude_plugin_installations as installations,
  deck_claude_plugin_refs as refs,
  decks,
  voices,
} from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { DeckChatContextInput } from "./deckChatContextDto";

const deckFields = {
  id: decks.id,
  name: decks.name,
  name_zh: decks.name_zh,
  name_en: decks.name_en,
  description: decks.description,
  description_zh: decks.description_zh,
  description_en: decks.description_en,
  enabled: decks.enabled,
};
const voiceFields = {
  id: voices.id,
  name: voices.name,
  name_zh: voices.name_zh,
  name_en: voices.name_en,
  system_prompt: voices.system_prompt,
  enabled: voices.enabled,
};
const pluginRefFields = {
  plugin_installation_id: refs.plugin_installation_id,
  package_spec: refs.package_spec,
  resolved_version: refs.resolved_version,
  artifact_digest: refs.artifact_digest,
  order_index: refs.order_index,
  enabled: sql<boolean>`${refs.enabled} = 1`,
  installation_status: installations.status,
};

export class DeckChatContextRepository {
  private readonly canonicalUserId: string;

  constructor(private readonly tx: DataTransaction, canonicalUserId: string) {
    this.canonicalUserId = decimalIdDto.parse(canonicalUserId);
  }

  async resolve(input: DeckChatContextInput) {
    const deck = (await this.tx.select(deckFields).from(decks).where(and(
      eq(decks.id, input.deck_id),
      eq(decks.owner_id, sql`${this.canonicalUserId}::bigint`),
    )).limit(1))[0];
    if (!deck) throw new AuthBoundaryError("DECK_ACCESS_DENIED", 404);

    const selectedVoices = await this.tx.select(voiceFields).from(voices).where(and(
      eq(voices.deck_id, input.deck_id),
      input.voice_id === null ? undefined : eq(voices.id, input.voice_id),
    )).orderBy(asc(voices.order_index), asc(voices.created_at), asc(voices.id));

    const pluginRefs = await this.tx.select(pluginRefFields).from(refs)
      .innerJoin(installations, eq(installations.id, refs.plugin_installation_id))
      .where(eq(refs.deck_id, input.deck_id))
      .orderBy(asc(refs.order_index), asc(refs.created_at), asc(refs.plugin_installation_id));
    return { deck, voices: selectedVoices, plugin_refs: pluginRefs };
  }
}
