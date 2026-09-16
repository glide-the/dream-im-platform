// [Input] Actor-scoped Workflow Run selectors and Dream-produced normalized Artifact facts.
// [Output] Strict Story Workspace authority, lifecycle and Story-index wire contracts.
// [Pos] Registry185-191 DTO boundary; no user, SQL, table, column or filesystem-path selectors.
// [Sync] 2026-09-16: define the final Story Workspace database cutover contracts.
import { z } from "zod";
import { workflowRunDto, workflowRunIdDto, workflowTimeDto } from "./workflowRunDto";

const identifier = z.string().min(1).max(255);
const hash = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const projectSlug = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const episodeCode = z.string().regex(/^EP(?:0[1-9]|[1-9][0-9])$/);
const episodeUid = z.string().regex(/^[0-9a-f]{32}$/);

export const storyWorkspaceEpisodeAuthorityDto = z.strictObject({
  schema: z.literal("story-workspace-episode-authority/v1"),
  workflow_run_id: workflowRunIdDto,
  episode_uid: episodeUid,
  story_slug: projectSlug,
  episode_code: episodeCode,
});

export const storyWorkspaceArtifactAuthorityDto = z.strictObject({
  run: workflowRunDto,
  thread_id: identifier,
  thread_updated_at: workflowTimeDto,
  deck_id: identifier,
  deck_display_name: identifier,
  launch_agent_id: identifier.nullable(),
  goal: z.string().min(1).max(12_000),
  project_story_slug: projectSlug,
  episode_authority: storyWorkspaceEpisodeAuthorityDto.nullable(),
  project_title: z.string().min(1).max(255).nullable(),
  confirmation_accepted: z.boolean(),
  confirmation_dispatched: z.boolean(),
});

export const storyWorkspaceArtifactRunsInputDto = z.strictObject({
  limit: z.number().int().min(1).max(100),
  cursor: z.strictObject({
    created_at: workflowTimeDto,
    workflow_run_id: workflowRunIdDto,
  }).nullable(),
});
export const storyWorkspaceArtifactRunsOutputDto = z.strictObject({
  runs: z.array(storyWorkspaceArtifactAuthorityDto),
  next_cursor: storyWorkspaceArtifactRunsInputDto.shape.cursor,
});

export const storyWorkspaceArtifactAuthorityInputDto = z.strictObject({
  workflow_run_id: workflowRunIdDto,
});
export const storyWorkspaceArtifactAuthorityOutputDto = z.strictObject({
  authority: storyWorkspaceArtifactAuthorityDto,
});

export const storyWorkspaceEpisodeAuthorityEnsureInputDto = z.strictObject({
  workflow_run_id: workflowRunIdDto,
  story_slug: projectSlug,
  episode_code: episodeCode,
});
export const storyWorkspaceEpisodeAuthorityEnsureOutputDto = z.strictObject({
  authority: storyWorkspaceEpisodeAuthorityDto,
  replayed: z.boolean(),
});

export const storyWorkspaceArtifactOutputReadyInputDto = z.strictObject({
  workflow_run_id: workflowRunIdDto,
  normalized_result_ready: z.literal(true),
});
export const storyWorkspaceArtifactOutputReadyOutputDto = z.strictObject({
  workflow_run_id: workflowRunIdDto,
  status: z.enum(["pending_review", "confirmed", "rejected", "completed"]),
  status_version: z.number().int().positive().safe(),
  replayed: z.boolean(),
});

export const storyWorkspaceArtifactProjectionDto = z.strictObject({
  source_project_id: projectSlug,
  title: z.string().trim().min(1).max(255),
  episode_count: z.number().int().min(1).max(99),
  artifact_manifest_revision: hash,
  script_revision: hash,
  script_size_bytes: z.number().int().min(0).safe(),
  artifact_status: z.literal("available"),
});

export const storyWorkspaceArtifactIndexInputDto = z.strictObject({
  workflow_run_id: workflowRunIdDto,
  projection: storyWorkspaceArtifactProjectionDto,
});
export const storyWorkspaceArtifactIndexReconcileInputDto = storyWorkspaceArtifactIndexInputDto.extend({
  expected_etag: hash,
});
export const storyWorkspaceArtifactIndexObservationDto = z.strictObject({
  run_id: workflowRunIdDto,
  project_id: projectSlug,
  project_title: z.string().min(1).max(255),
  story_id: identifier.nullable(),
  status: z.enum(["missing", "stale", "indexed", "failed"]),
  observed_manifest_revision: hash,
  observed_script_revision: hash,
  indexed_manifest_revision: hash.nullable(),
  indexed_script_revision: hash.nullable(),
  episode_count: z.number().int().min(1).max(99),
  last_indexed_at: workflowTimeDto.nullable(),
  error_code: z.enum([
    "story_index_row_missing",
    "story_index_write_failed",
    "story_index_conflict",
    "story_index_revision_conflict",
  ]).nullable(),
  retryable: z.boolean(),
  etag: hash,
});
export const storyWorkspaceArtifactIndexOutputDto = z.strictObject({
  observation: storyWorkspaceArtifactIndexObservationDto,
  write_status: z.enum(["created", "updated", "same_revision"]).nullable(),
});

export const storyWorkspaceArtifactOperationContracts = {
  "story-workspace-artifact.runs": { kind: "read" as const, userScope: "dream:read", input: storyWorkspaceArtifactRunsInputDto, output: storyWorkspaceArtifactRunsOutputDto },
  "story-workspace-artifact.authority": { kind: "read" as const, userScope: "dream:read", input: storyWorkspaceArtifactAuthorityInputDto, output: storyWorkspaceArtifactAuthorityOutputDto },
  "story-workspace-artifact.episode-authority.ensure": { kind: "write" as const, userScope: "dream:write", input: storyWorkspaceEpisodeAuthorityEnsureInputDto, output: storyWorkspaceEpisodeAuthorityEnsureOutputDto },
  "story-workspace-artifact.output-ready": { kind: "write" as const, userScope: "dream:write", input: storyWorkspaceArtifactOutputReadyInputDto, output: storyWorkspaceArtifactOutputReadyOutputDto },
  "story-workspace-artifact.index.inspect": { kind: "read" as const, userScope: "dream:read", input: storyWorkspaceArtifactIndexInputDto, output: storyWorkspaceArtifactIndexOutputDto },
  "story-workspace-artifact.index.materialize": { kind: "write" as const, userScope: "dream:write", input: storyWorkspaceArtifactIndexInputDto, output: storyWorkspaceArtifactIndexOutputDto },
  "story-workspace-artifact.index.reconcile": { kind: "write" as const, userScope: "dream:write", input: storyWorkspaceArtifactIndexReconcileInputDto, output: storyWorkspaceArtifactIndexOutputDto },
};

export type StoryWorkspaceArtifactOperation = keyof typeof storyWorkspaceArtifactOperationContracts;
export type StoryWorkspaceArtifactProjection = z.infer<typeof storyWorkspaceArtifactProjectionDto>;
export type StoryWorkspaceArtifactAuthority = z.infer<typeof storyWorkspaceArtifactAuthorityDto>;
export type StoryWorkspaceArtifactRunsInput = z.infer<typeof storyWorkspaceArtifactRunsInputDto>;
export type StoryWorkspaceEpisodeAuthority = z.infer<typeof storyWorkspaceEpisodeAuthorityDto>;
