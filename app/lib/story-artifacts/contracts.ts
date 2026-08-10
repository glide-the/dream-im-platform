import { z } from "zod";

export const artifactKindSchema = z.enum([
  "script",
  "episode_outline",
  "storyboard",
  "review_report",
]);

export type StoryArtifactKind = z.infer<typeof artifactKindSchema>;

export const artifactFileNames: Record<StoryArtifactKind, string> = {
  script: "script.md",
  episode_outline: "episode-outline.md",
  storyboard: "storyboard.yaml",
  review_report: "review-report.md",
};

export const storyArtifactPreviewQuerySchema = z.strictObject({
  episodeId: z.string().regex(/^EP[0-9]{2}$/),
  kind: artifactKindSchema,
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(262_144).default(65_536),
  revision: z
    .string()
    .regex(/^sha256:[0-9a-f]{64}$/)
    .optional(),
});

const runIdSchema = z.string().regex(/^run_[0-9a-f]{32}$/);
const episodeUidSchema = z.string().regex(/^[0-9a-f]{32}$/);
const projectIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(120);
const dateTimeSchema = z.string().min(1).max(80);

const legacyRegistrySchema = z.strictObject({
  schema_version: z.literal("dream-episode/v1"),
  workflow_run_id: runIdSchema,
  episode_uid: episodeUidSchema,
  story_slug: projectIdSchema,
  episode_code: z.literal("EP01"),
  episode_root: z.string().min(1).max(512),
  revision: z.literal(1),
  updated_at: dateTimeSchema,
});

const registryEntrySchema = z.strictObject({
  episode_uid: episodeUidSchema,
  episode_number: z.number().int().min(1).max(99),
  episode_code: z.string().regex(/^EP[0-9]{2}$/),
  episode_root: z.string().min(1).max(512),
  created_at: dateTimeSchema,
});

const multiRegistrySchema = z.strictObject({
  schema_version: z.literal("dream-episode/v2"),
  workflow_run_id: runIdSchema,
  story_slug: projectIdSchema,
  active_episode_uid: episodeUidSchema,
  episodes: z.array(registryEntrySchema).min(1).max(99),
  revision: z.number().int().min(1),
  updated_at: dateTimeSchema,
});

export const episodeRegistrySchema = z.discriminatedUnion("schema_version", [
  legacyRegistrySchema,
  multiRegistrySchema,
]);

export type EpisodeRegistry = z.infer<typeof episodeRegistrySchema>;

export type StoryArtifactSurfaceFile = {
  kind: StoryArtifactKind;
  label: string;
  fileName: string;
  available: boolean;
  sizeBytes: number | null;
  updatedAt: string | null;
  revision: string | null;
};

export type StoryArtifactSurface = {
  storyId: string;
  projectId: string;
  sourceRunId: string;
  registryRevision: number;
  indexedScriptRevision: string | null;
  episodes: Array<{
    id: string;
    active: boolean;
    artifacts: StoryArtifactSurfaceFile[];
  }>;
};

export type StoryArtifactPreview = {
  storyId: string;
  projectId: string;
  episodeId: string;
  kind: StoryArtifactKind;
  fileName: string;
  content: string;
  offset: number;
  nextOffset: number | null;
  totalBytes: number;
  truncated: boolean;
  updatedAt: string;
  revision: string;
  etag: string;
};
