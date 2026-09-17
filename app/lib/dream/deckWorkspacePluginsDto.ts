// [Input] One actor-owned Thread and closed workspace profile selected by Dream server orchestration.
// [Output] Strict Deck refs plus nullable Story Workspace adapter candidates for filesystem packing.
// [Pos] Registry106 data DTO; no artifact bytes, paths, SQL, actor selector or workspace mutation.
// [Sync] 2026-09-15: expose only metadata consumed by Dream's existing immutable workspace packer.
import { z } from "zod";
import { deckPluginInstallationDto } from "./deckRuntimeDataDto";

const id = z.string().min(1);
const order = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const installationStatus = deckPluginInstallationDto.shape.status;

export const deckWorkspaceProfileDto = z.enum(["standard", "story_workspace"]);
export const deckWorkspacePluginsInputDto = z.strictObject({
  thread_id: id,
  profile: deckWorkspaceProfileDto,
});

export const workspacePluginDto = z.strictObject({
  plugin_installation_id: id,
  package_spec: z.string().min(1),
  package_name: id,
  marketplace: id,
  resolved_version: id,
  artifact_digest: deckPluginInstallationDto.shape.artifact_digest,
  installation_status: installationStatus,
});

export const workspaceDeckPluginRefDto = workspacePluginDto.extend({
  order_index: order,
});

export const storyWorkspaceAdapterCandidateDto = z.strictObject({
  latest_status: installationStatus.nullable(),
  ready: workspacePluginDto.nullable(),
});

export const deckWorkspacePluginsOutputDto = z.strictObject({
  thread_id: id,
  deck_id: id.nullable(),
  refs: z.array(workspaceDeckPluginRefDto),
  story_workspace_adapter: storyWorkspaceAdapterCandidateDto.nullable(),
});

export const deckWorkspacePluginPolicyDto = z.strictObject({
  story_workspace_adapter: z.strictObject({
    package_name: id,
    marketplace: id,
    resolved_version: id.nullable(),
  }),
});

export const deckWorkspacePluginsOperationContracts = {
  "deck-workspace-plugins.resolve": {
    kind: "read" as const,
    userScope: "dream:read",
    input: deckWorkspacePluginsInputDto,
    output: deckWorkspacePluginsOutputDto,
  },
};

export type DeckWorkspacePluginsInput = z.infer<typeof deckWorkspacePluginsInputDto>;
export type DeckWorkspacePluginPolicy = z.infer<typeof deckWorkspacePluginPolicyDto>;
export type DeckWorkspacePluginsOperation = keyof typeof deckWorkspacePluginsOperationContracts;
