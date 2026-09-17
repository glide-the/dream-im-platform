// [Input] Empty current-actor request for the Admin-configured default Deck plugin.
// [Output] One nullable purpose-specific installation projection for Dream's local verifier.
// [Pos] Registry104 read boundary; configuration, evidence, identity and selectors stay server-owned.
// [Sync] 2026-09-15: expose only the six fields required before existing Deck writes recheck evidence.
import { z } from "zod";
import { deckPluginInstallationDto } from "./deckRuntimeDataDto";

export const deckDefaultPluginInstallationDto = z.strictObject({
  plugin_installation_id: deckPluginInstallationDto.shape.id,
  package_name: deckPluginInstallationDto.shape.package_name,
  marketplace: deckPluginInstallationDto.shape.marketplace,
  resolved_version: deckPluginInstallationDto.shape.resolved_version,
  artifact_digest: deckPluginInstallationDto.shape.artifact_digest,
  compatibility_json: deckPluginInstallationDto.shape.compatibility_json,
});

export const deckDefaultPluginResolveOperationContracts = {
  "deck.default-plugin.resolve": {
    kind: "read" as const,
    userScope: "dream:read",
    input: z.strictObject({}),
    output: z.strictObject({ installation: deckDefaultPluginInstallationDto.nullable() }),
  },
};

export type DeckDefaultPluginInstallation = z.infer<typeof deckDefaultPluginInstallationDto>;
export type DeckDefaultPluginResolveOperation = keyof typeof deckDefaultPluginResolveOperationContracts;
