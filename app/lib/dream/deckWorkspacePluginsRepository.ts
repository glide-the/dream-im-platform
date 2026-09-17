// [Input] Validated canonical actor, Thread/profile, server adapter policy and caller-owned Admin UOW.
// [Output] Owned Thread Deck refs and ordered adapter installation status facts through typed Drizzle.
// [Pos] Registry106 ORM read; Dream retains artifact verification, packing, freeze and Runtime behavior.
// [Sync] 2026-09-15: preserve legacy ready-adapter selection order without accepting package selectors.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  chat_thread as threads,
  claude_plugin_installations as installations,
  deck_claude_plugin_refs as refs,
  decks,
} from "@ink-memory/db/schema/dream";
import { AuthBoundaryError } from "../auth/config";
import { decimalIdDto } from "../auth/dto";
import type { DataTransaction } from "./database";
import type { DeckWorkspacePluginPolicy, DeckWorkspacePluginsInput } from "./deckWorkspacePluginsDto";

const adapterFields = {
  plugin_installation_id: installations.id,
  package_name: installations.package_name,
  marketplace: installations.marketplace,
  resolved_version: installations.resolved_version,
  artifact_digest: installations.artifact_digest,
  installation_status: installations.status,
};

export class DeckWorkspacePluginsRepository {
  constructor(
    private readonly tx: DataTransaction,
    canonicalUserId: string,
  ) {
    this.canonicalUserId = decimalIdDto.parse(canonicalUserId);
  }

  private readonly canonicalUserId: string;

  async resolve(input: DeckWorkspacePluginsInput, policy: DeckWorkspacePluginPolicy | null) {
    const thread = (await this.tx.select({ id: threads.id, deck_id: threads.deck_id })
      .from(threads)
      .where(and(
        eq(threads.id, input.thread_id),
        eq(threads.user_id, sql`${this.canonicalUserId}::bigint`),
      ))
      .limit(1))[0];
    if (!thread) throw new AuthBoundaryError("ENTITY_NOT_FOUND", 404);
    if (thread.deck_id === null) {
      return {
        thread_id: input.thread_id,
        deck_id: null,
        refs: [],
        story_workspace_adapter: null,
      };
    }

    const ownedDeck = (await this.tx.select({ id: decks.id }).from(decks).where(and(
      eq(decks.id, thread.deck_id),
      eq(decks.owner_id, sql`${this.canonicalUserId}::bigint`),
    )).limit(1))[0];
    if (!ownedDeck) throw new AuthBoundaryError("DECK_ACCESS_DENIED", 404);

    const selectedRefs = await this.tx.select({
      plugin_installation_id: refs.plugin_installation_id,
      package_spec: refs.package_spec,
      package_name: installations.package_name,
      marketplace: installations.marketplace,
      resolved_version: refs.resolved_version,
      artifact_digest: refs.artifact_digest,
      installation_status: installations.status,
      order_index: refs.order_index,
    }).from(refs).innerJoin(installations, eq(installations.id, refs.plugin_installation_id)).where(and(
      eq(refs.deck_id, thread.deck_id),
      eq(refs.enabled, 1),
    )).orderBy(asc(refs.order_index), asc(refs.created_at), asc(refs.plugin_installation_id));
    if (input.profile === "standard") {
      return {
        thread_id: input.thread_id,
        deck_id: thread.deck_id,
        refs: selectedRefs,
        story_workspace_adapter: null,
      };
    }
    if (policy === null) throw new AuthBoundaryError("WORKSPACE_PLUGIN_POLICY_NOT_CONFIGURED");
    const configured = policy.story_workspace_adapter;
    const rows = await this.tx.select(adapterFields).from(installations).where(and(
      eq(installations.package_name, configured.package_name),
      eq(installations.marketplace, configured.marketplace),
      configured.resolved_version === null
        ? undefined
        : eq(installations.resolved_version, configured.resolved_version),
    )).orderBy(
      sql`${installations.installed_at} DESC NULLS LAST`,
      desc(installations.created_at),
      desc(installations.id),
    );
    const ready = rows.find(row => row.installation_status === "ready") ?? null;
    return {
      thread_id: input.thread_id,
      deck_id: thread.deck_id,
      refs: selectedRefs,
      story_workspace_adapter: {
        latest_status: rows[0]?.installation_status ?? null,
        ready: ready === null ? null : {
          ...ready,
          package_spec: `${ready.package_name}@${ready.marketplace}`,
        },
      },
    };
  }
}
