// [Input] Caller-owned Admin UOW and validated server Deck policy package/version.
// [Output] Stable newest ready exact-match installation or explicit absence.
// [Pos] Purpose-specific typed Drizzle read; it owns no connection, actor, policy parsing or filesystem work.
// [Sync] 2026-09-15: retain legacy newest-first installation order without exposing general listing.
import { and, desc, eq } from "drizzle-orm";
import { claude_plugin_installations as installations } from "@ink-memory/db/schema/dream";
import type { DataTransaction } from "./database";
import type { DeckVoicePolicyDto } from "./deckVoiceDto";
import type { DeckDefaultPluginInstallation } from "./deckDefaultPluginResolveDto";

export class DeckDefaultPluginResolveRepository {
  constructor(private readonly tx: DataTransaction) {}

  async resolve(policy: Pick<DeckVoicePolicyDto, "default_plugin_package_name" | "default_plugin_version">): Promise<DeckDefaultPluginInstallation | null> {
    const row = (await this.tx.select({
      plugin_installation_id: installations.id,
      package_name: installations.package_name,
      marketplace: installations.marketplace,
      resolved_version: installations.resolved_version,
      artifact_digest: installations.artifact_digest,
      compatibility_json: installations.compatibility_json,
    }).from(installations).where(and(
      eq(installations.package_name, policy.default_plugin_package_name),
      eq(installations.resolved_version, policy.default_plugin_version),
      eq(installations.status, "ready"),
    )).orderBy(desc(installations.created_at), desc(installations.id)).limit(1))[0];
    return row ?? null;
  }
}
