// [Input] Verified canonical actor and caller-owned UOW; closed DTOs and configured Deck policy.
// [Output] Exact owner-filtered refs/Voice rows, atomic semantic ref replacement and memory repair.
// [Pos] Typed Admin ORM only; filesystem bytes, CLI checks, Runtime and independent HTTP stay in Dream.
// [Sync] 2026-09-15: Deck-before-Voice locks; installation locks/evidence recheck precede every ref mutation.
import { and, asc, eq, getTableColumns, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { decks, voices, chat_thread, deck_claude_plugin_refs as refs, claude_plugin_installations as installations } from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
import type { DeckVoicePolicyDto } from "./deckVoiceDto";
import { DeckVoiceRepository } from "./deckVoiceRepository";
import { pgTimestampToIso } from "./chatThreadDto";
import { inspectMemoryConfig } from "./deckContentCanonical";
import * as dto from "./deckRuntimeDataDto";
const installationFields = { id: installations.id, requested_package_spec: installations.requested_package_spec, package_name: installations.package_name, marketplace: installations.marketplace, resolved_version: installations.resolved_version, artifact_digest: installations.artifact_digest, claude_cli_version: installations.claude_cli_version, source_type: installations.source_type, status: installations.status, manifest_json: installations.manifest_json, component_inventory_json: installations.component_inventory_json, compatibility_json: installations.compatibility_json };
const refFields = { ...getTableColumns(refs), installation_status: installations.status, source_type: installations.source_type, claude_cli_version: installations.claude_cli_version, manifest_json: installations.manifest_json, component_inventory_json: installations.component_inventory_json };
function refRow(row: typeof refs.$inferSelect & { installation_status: string; source_type: string; claude_cli_version: string; manifest_json: string | null; component_inventory_json: string }) {
  if (row.enabled !== 0 && row.enabled !== 1) throw new AuthBoundaryError("DREAM_DATA_UNAVAILABLE");
  const { deck_id, plugin_installation_id, package_spec, resolved_version, artifact_digest, order_index, installation_status, source_type, claude_cli_version, manifest_json, component_inventory_json } = row;
  return dto.deckPluginRefDto.parse({ deck_id, plugin_installation_id, package_spec, resolved_version, artifact_digest, order_index, installation_status, source_type, claude_cli_version, manifest_json, component_inventory_json, enabled: row.enabled === 1, created_at: pgTimestampToIso(row.created_at), updated_at: pgTimestampToIso(row.updated_at) });
}
export class DeckRuntimeDataRepository {
  private readonly canonicalUserId: string;
  private readonly deckStore: DeckVoiceRepository;
  constructor(private readonly tx: DataTransaction, canonicalUserId: string, private readonly policy: DeckVoicePolicyDto) {
    this.canonicalUserId = decimalIdDto.parse(canonicalUserId);
    this.deckStore = new DeckVoiceRepository(tx, canonicalUserId, policy);
  }
  private owner(column: typeof decks.owner_id | typeof voices.owner_id | typeof chat_thread.user_id) { return eq(column, sql`${this.canonicalUserId}::bigint`); }
  private async ownedThread(threadId: string) {
    const rows = await this.tx.select({ id: chat_thread.id, deck_id: chat_thread.deck_id }).from(chat_thread).where(and(eq(chat_thread.id, threadId), this.owner(chat_thread.user_id))).limit(1);
    if (!rows[0]) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
    return rows[0];
  }
  private async rows(deckId: string) {
    return this.tx.select(refFields).from(refs).innerJoin(installations, eq(installations.id, refs.plugin_installation_id)).where(eq(refs.deck_id, deckId)).orderBy(asc(refs.order_index), asc(refs.created_at), asc(refs.plugin_installation_id));
  }
  async list(deckId: string) {
    await this.deckStore.requireOwnedDeck(deckId, "share");
    return { deck_id: deckId, refs: (await this.rows(deckId)).map(refRow) };
  }
  async prepare(input: z.infer<typeof dto.pluginRefsPrepareInputDto>) {
    await this.deckStore.requireOwnedDeck(input.deck_id, "share");
    if (!input.installation_ids.length) return { installations: [] };
    const selected = await this.tx.select(installationFields).from(installations).where(inArray(installations.id, input.installation_ids)).orderBy(asc(installations.id)).for("share");
    if (selected.length !== input.installation_ids.length) throw new AuthBoundaryError("CLAUDE_PLUGIN_NOT_FOUND", 404);
    if (selected.some(row => row.status !== "ready")) throw new AuthBoundaryError("CLAUDE_PLUGIN_NOT_READY", 409);
    return { installations: selected.map(row => dto.deckPluginInstallationDto.parse(row)) };
  }
  async runtimeRead(threadId: string) {
    const thread = await this.ownedThread(threadId);
    if (thread.deck_id === null) return { deck_id: null, refs: [] };
    await this.deckStore.requireOwnedDeck(thread.deck_id, "share");
    const selected = await this.tx.select({ ...refFields, package_name: installations.package_name, marketplace: installations.marketplace, installation_compatibility_json: installations.compatibility_json }).from(refs).innerJoin(installations, eq(installations.id, refs.plugin_installation_id)).where(and(eq(refs.deck_id, thread.deck_id), eq(refs.enabled, 1))).orderBy(asc(refs.order_index), asc(refs.created_at), asc(refs.plugin_installation_id));
    return { deck_id: thread.deck_id, refs: selected.map(row => dto.deckPluginRuntimeRefDto.parse({ ...refRow(row), package_name: row.package_name, marketplace: row.marketplace, installation_compatibility_json: row.installation_compatibility_json })) };
  }
  async replace(input: z.infer<typeof dto.pluginRefsReplaceInputDto>) {
    await this.deckStore.requireOwnedDeck(input.deck_id, "update");
    const ids = input.refs.map(row => row.plugin_installation_id);
    const selected = ids.length ? await this.tx.select(installationFields).from(installations).where(inArray(installations.id, ids)).orderBy(asc(installations.id)).for("share") : [];
    if (selected.length !== ids.length) throw new AuthBoundaryError("CLAUDE_PLUGIN_NOT_FOUND", 404);
    const byId = new Map(selected.map(row => [row.id, row]));
    const requested = input.refs.map(ref => {
      const row = byId.get(ref.plugin_installation_id)!;
      if (row.status !== "ready") throw new AuthBoundaryError("CLAUDE_PLUGIN_NOT_READY", 409);
      if (row.package_name !== ref.package_name || row.marketplace !== ref.marketplace || row.resolved_version !== ref.resolved_version || row.artifact_digest !== ref.artifact_digest || row.compatibility_json !== ref.compatibility_json) throw new AuthBoundaryError("CLAUDE_PLUGIN_INTEGRITY_FAILED", 409);
      return { plugin_installation_id: row.id, package_spec: `${row.package_name}@${row.marketplace}`, resolved_version: row.resolved_version, artifact_digest: row.artifact_digest, enabled: ref.enabled, order_index: ref.order_index };
    });
    const order = (a: { order_index: number; plugin_installation_id: string }, b: { order_index: number; plugin_installation_id: string }) => a.order_index - b.order_index || (a.plugin_installation_id < b.plugin_installation_id ? -1 : a.plugin_installation_id > b.plugin_installation_id ? 1 : 0);
    requested.sort(order);
    const existing = (await this.rows(input.deck_id)).map(row => { const { plugin_installation_id, package_spec, resolved_version, artifact_digest, enabled, order_index } = refRow(row); return { plugin_installation_id, package_spec, resolved_version, artifact_digest, enabled, order_index }; }).sort(order);
    const changed = JSON.stringify(existing) !== JSON.stringify(requested);
    if (changed) {
      await this.tx.delete(refs).where(eq(refs.deck_id, input.deck_id));
      if (requested.length) await this.tx.insert(refs).values(requested.map(row => ({ ...row, deck_id: input.deck_id, enabled: row.enabled ? 1 : 0 })));
      await this.tx.update(decks).set({ draft_revision: sql`${decks.draft_revision}+1`, updated_at: sql`CURRENT_TIMESTAMP` }).where(and(eq(decks.id, input.deck_id), this.owner(decks.owner_id)));
    }
    return { ...(await this.list(input.deck_id)), changed };
  }
  async analysisVoices() {
    const retired = this.policy.retired_system_deck_ids;
    const visible = retired.length ? sql`(${decks.parent_id} IS NULL OR ${notInArray(decks.parent_id, retired)} OR ${decks.has_local_changes} IS TRUE OR EXISTS(SELECT 1 FROM ${voices} AS changed_voice WHERE changed_voice.deck_id=${decks.id} AND changed_voice.has_local_changes IS TRUE))` : undefined;
    const rows = await this.tx.select({ voice_id: voices.id, name: voices.name, system_prompt: voices.system_prompt, icon: voices.icon, color: voices.color }).from(voices).innerJoin(decks, eq(decks.id, voices.deck_id)).where(and(this.owner(decks.owner_id), eq(decks.enabled, true), eq(voices.enabled, true), visible)).orderBy(asc(voices.order_index), asc(voices.created_at), asc(voices.id));
    return { voices: rows.map(row => dto.analysisVoiceDto.parse(row)) };
  }
  async memory(threadId: string) {
    await this.ownedThread(threadId);
    const pre = (await this.tx.select({ id: voices.id, deck_id: voices.deck_id }).from(voices).innerJoin(decks, eq(decks.id, voices.deck_id)).where(and(eq(voices.thread_id, threadId), this.owner(voices.owner_id), this.owner(decks.owner_id))).limit(1))[0];
    if (!pre) return { memory_workspace_config_json: null, repaired: false };
    await this.deckStore.requireOwnedDeck(pre.deck_id, "update");
    const row = (await this.tx.select({ id: voices.id, raw: voices.memory_workspace_config }).from(voices).where(and(eq(voices.id, pre.id), eq(voices.thread_id, threadId), this.owner(voices.owner_id))).limit(1).for("update", { of: voices }))[0];
    if (!row) return { memory_workspace_config_json: null, repaired: false };
    if ((await inspectMemoryConfig(row.raw)).is_object) return { memory_workspace_config_json: row.raw, repaired: false };
    const raw = this.policy.default_memory_workspace_config_json;
    await this.tx.update(voices).set({ memory_workspace_config: raw, updated_at: sql`CURRENT_TIMESTAMP` }).where(eq(voices.id, row.id));
    // Preserve the existing repair contract: Voice-only touch, no draft advance.
    return { memory_workspace_config_json: raw, repaired: true };
  }
}
