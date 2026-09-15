// [Input] Canonical actor and validated binding DTO inside one caller-owned Admin transaction.
// [Output] Owner-checked Deck/Workspace, ordered binding/release facts and atomic CAS mutations.
// [Pos] Registry122-126 typed Drizzle Repository; no Runtime, filesystem or caller-selected SQL.
// [Sync] 2026-09-16: move Deck Plugin binding persistence into Admin.
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, max, sql } from "drizzle-orm";
import { storyWorkspaceWorkspaces as workspaces } from "@ink-memory/db/schema";
import { decks, deck_plugin_bindings as bindings, deck_plugin_releases as releases } from "@ink-memory/db/schema/dream";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";

const bindingFields = {
  deck_plugin_binding_id: bindings.deck_plugin_binding_id,
  deck_id: bindings.deck_id,
  workspace_id: bindings.workspace_id,
  creator_id: bindings.creator_id,
  deck_plugin_id: bindings.deck_plugin_id,
  deck_plugin_version: bindings.deck_plugin_version,
  binding_revision: bindings.binding_revision,
  status: bindings.status,
  applied_to: bindings.applied_to,
  created_at: bindings.created_at,
  updated_at: bindings.updated_at,
};

export class DeckPluginBindingRepository {
  private readonly actor: string;

  constructor(private readonly tx: DataTransaction, actor: string) {
    this.actor = decimalIdDto.parse(actor);
  }

  async ownsDeckWorkspace(deckId: string, workspaceId: string, lock: "share" | "update" = "share") {
    const query = this.tx.select({ id: decks.id }).from(decks).innerJoin(workspaces, and(
      eq(workspaces.id, workspaceId),
      eq(workspaces.owner_id, decks.owner_id),
    )).where(and(
      eq(decks.id, deckId),
      eq(decks.owner_id, sql`${this.actor}::bigint`),
      eq(workspaces.owner_id, sql`${this.actor}::bigint`),
    )).limit(1);
    return (await query.for(lock))[0] ?? null;
  }

  async current(deckId: string, lock: "share" | "update" = "share") {
    return (await this.tx.select(bindingFields).from(bindings).where(and(
      eq(bindings.deck_id, deckId),
      eq(bindings.status, "active"),
    )).limit(1).for(lock))[0] ?? null;
  }

  async latestRevision(deckId: string) {
    const row = (await this.tx.select({ revision: max(bindings.binding_revision) }).from(bindings).where(eq(bindings.deck_id, deckId)))[0];
    return row?.revision ?? 0;
  }

  async history(deckId: string, limit: number) {
    return this.tx.select(bindingFields).from(bindings).where(eq(bindings.deck_id, deckId))
      .orderBy(desc(bindings.binding_revision)).limit(limit).for("share");
  }

  async selectableReleases() {
    return this.tx.select({
      display_name: releases.display_name,
      deck_plugin_id: releases.deck_plugin_id,
      deck_plugin_version: releases.deck_plugin_version,
      status: releases.status,
    }).from(releases).where(inArray(releases.status, ["published", "deprecated", "revoked"]))
      .orderBy(asc(releases.display_name), asc(releases.deck_plugin_id), desc(releases.deck_plugin_version)).for("share");
  }

  async markCurrentStale(bindingId: string, revision: number) {
    return (await this.tx.update(bindings).set({ status: "stale", updated_at: sql`CURRENT_TIMESTAMP` }).where(and(
      eq(bindings.deck_plugin_binding_id, bindingId),
      eq(bindings.status, "active"),
      eq(bindings.binding_revision, revision),
    )).returning({ id: bindings.deck_plugin_binding_id })).length === 1;
  }

  async insert(input: { deck_id: string; workspace_id: string; deck_plugin_id: string; deck_plugin_version: string; binding_revision: number }) {
    return (await this.tx.insert(bindings).values({
      deck_plugin_binding_id: `dpb_${randomUUID().replaceAll("-", "")}`,
      deck_id: input.deck_id,
      workspace_id: input.workspace_id,
      creator_id: this.actor,
      deck_plugin_id: input.deck_plugin_id,
      deck_plugin_version: input.deck_plugin_version,
      binding_revision: input.binding_revision,
      status: "active",
      applied_to: "next_run",
    }).returning(bindingFields))[0];
  }

  async advanceDraftRevision(deckId: string) {
    await this.tx.update(decks).set({ draft_revision: sql`${decks.draft_revision} + 1`, updated_at: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(decks.id, deckId), eq(decks.owner_id, sql`${this.actor}::bigint`)));
  }
}

export type DeckPluginBindingRow = NonNullable<Awaited<ReturnType<DeckPluginBindingRepository["current"]>>>;
