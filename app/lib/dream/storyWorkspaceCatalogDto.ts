// [Input] Authenticated Story Workspace catalog browse, default Workspace, and controlled edit intents.
// [Output] Strict business DTOs with closed view/resource discriminators and browser-safe projections.
// [Pos] Registry114 contract boundary; no actor, table, column, SQL, transaction, or filesystem selector crosses it.
// [Sync] 2026-09-15: define the Admin-owned Story Workspace catalog DTO/ORM contract.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";

const entityIdDto = z.string().trim().min(1).max(255);
const nullableTextDto = z.string().nullable();
const safeNonnegativeIntegerDto = z.number().int().safe().nonnegative();
const signedIntegerDto = z.number().int().min(-2_147_483_648).max(2_147_483_647);
const reviewStatusDto = z.enum(["pending", "confirmed", "rejected"]);
const sortOrderDto = z.enum(["asc", "desc"]);

export const storyWorkspaceCatalogWorkspaceDto = z.strictObject({
  id: entityIdDto,
  name: z.string(),
  settings: z.record(z.string(), z.unknown()),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
});

export const storyWorkspaceCatalogStoryDto = z.strictObject({
  id: entityIdDto,
  identifier: z.string(),
  title: z.string(),
  description: nullableTextDto,
  status: z.enum(["draft", "published", "archived"]),
  review_status: reviewStatusDto,
  review_notes: nullableTextDto,
  type: z.enum(["short", "long", "script", "outline"]),
  character_count: safeNonnegativeIntegerDto,
  scene_count: safeNonnegativeIntegerDto,
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  confirmed_at: isoTimeDto.nullable(),
  source_run_id: nullableTextDto,
  source_project_id: nullableTextDto,
  episode_count: safeNonnegativeIntegerDto.nullable(),
  artifact_status: z.enum(["generating", "available", "missing", "invalid"]).nullable(),
  artifact_manifest_revision: nullableTextDto,
  script_revision: nullableTextDto,
  artifact_sync_status: z.enum(["syncing", "indexed", "stale", "failed"]).nullable(),
  artifact_indexed_at: isoTimeDto.nullable(),
  artifact_sync_error_code: z.enum([
    "story_index_row_missing", "story_index_schema_unavailable", "story_index_database_unavailable",
    "story_index_write_failed", "story_index_conflict", "story_index_invalid_artifact",
    "story_index_revision_conflict", "artifact_missing",
  ]).nullable(),
  script_size_bytes: safeNonnegativeIntegerDto.nullable(),
  artifact_available: z.boolean().nullable(),
  reconcile_version: safeNonnegativeIntegerDto.nullable(),
});

export const storyWorkspaceCatalogCharacterDto = z.strictObject({
  id: entityIdDto,
  identifier: z.string(),
  name: z.string(),
  avatar_url: nullableTextDto,
  identity: nullableTextDto,
  personality: nullableTextDto,
  background: nullableTextDto,
  catchphrase: nullableTextDto,
  tags: z.array(z.string()),
  story_count: safeNonnegativeIntegerDto,
  review_status: reviewStatusDto,
  review_notes: nullableTextDto,
  status: z.enum(["active", "archived"]),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  confirmed_at: isoTimeDto.nullable(),
  archived_at: isoTimeDto.nullable(),
});

export const storyWorkspaceCatalogSceneDto = z.strictObject({
  id: entityIdDto,
  identifier: z.string(),
  name: z.string(),
  description: nullableTextDto,
  story_id: entityIdDto.nullable(),
  character_count: safeNonnegativeIntegerDto,
  order_index: signedIntegerDto,
  review_status: reviewStatusDto,
  review_notes: nullableTextDto,
  status: z.enum(["active", "archived"]),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  confirmed_at: isoTimeDto.nullable(),
  archived_at: isoTimeDto.nullable(),
});

const paginationDto = z.strictObject({
  page: z.number().int().min(1),
  per_page: z.number().int().min(1).max(100),
  total: safeNonnegativeIntegerDto,
  total_pages: safeNonnegativeIntegerDto,
});
const storyListInputDto = z.strictObject({
  view: z.literal("story_list"), q: z.string().max(1_000).nullable(),
  review_status: z.array(reviewStatusDto), status: z.array(z.enum(["draft", "published", "archived"])),
  type: z.array(z.enum(["short", "long", "script", "outline"])),
  sort: z.enum(["updated_at", "created_at", "title"]), order: sortOrderDto,
  page: z.number().int().min(1), per_page: z.number().int().min(1).max(100),
});
const characterListInputDto = z.strictObject({
  view: z.literal("character_list"), q: z.string().max(1_000).nullable(),
  review_status: z.array(reviewStatusDto),
  sort: z.enum(["updated_at", "created_at", "name"]), order: sortOrderDto,
  page: z.number().int().min(1), per_page: z.number().int().min(1).max(100),
});
const sceneListInputDto = z.strictObject({
  view: z.literal("scene_list"), q: z.string().max(1_000).nullable(),
  review_status: z.array(reviewStatusDto), story_id: entityIdDto.nullable(),
  sort: z.enum(["updated_at", "created_at", "name", "order_index"]), order: sortOrderDto,
  page: z.number().int().min(1), per_page: z.number().int().min(1).max(100),
});

export const storyWorkspaceCatalogReadInputDto = z.discriminatedUnion("view", [
  storyListInputDto,
  z.strictObject({ view: z.literal("story_detail"), resource_id: entityIdDto }),
  characterListInputDto,
  z.strictObject({ view: z.literal("character_detail"), resource_id: entityIdDto }),
  sceneListInputDto,
  z.strictObject({ view: z.literal("scene_detail"), resource_id: entityIdDto }),
]);

const relatedCharacterDto = storyWorkspaceCatalogCharacterDto.extend({ role_type: nullableTextDto });
const storyDetailDto = storyWorkspaceCatalogStoryDto.extend({
  characters: z.array(relatedCharacterDto), scenes: z.array(storyWorkspaceCatalogSceneDto),
});
const characterDetailDto = storyWorkspaceCatalogCharacterDto.extend({
  stories: z.array(storyWorkspaceCatalogStoryDto),
});
const sceneDetailDto = storyWorkspaceCatalogSceneDto.extend({
  story: storyWorkspaceCatalogStoryDto.nullable(), characters: z.array(storyWorkspaceCatalogCharacterDto),
});
export const storyWorkspaceCatalogReadResultDto = z.discriminatedUnion("view", [
  z.strictObject({ view: z.literal("story_list"), data: z.array(storyWorkspaceCatalogStoryDto), pagination: paginationDto }),
  z.strictObject({ view: z.literal("story_detail"), item: storyDetailDto }),
  z.strictObject({ view: z.literal("character_list"), data: z.array(storyWorkspaceCatalogCharacterDto), pagination: paginationDto }),
  z.strictObject({ view: z.literal("character_detail"), item: characterDetailDto }),
  z.strictObject({ view: z.literal("scene_list"), data: z.array(storyWorkspaceCatalogSceneDto), pagination: paginationDto }),
  z.strictObject({ view: z.literal("scene_detail"), item: sceneDetailDto }),
]);

const workspacePatchDto = z.strictObject({ name: z.string().optional(), settings: z.record(z.string(), z.unknown()).optional() });
const storyPatchDto = z.strictObject({ title: z.string().optional(), description: nullableTextDto.optional(),
  content: nullableTextDto.optional(), type: z.enum(["short", "long", "script", "outline"]).optional() });
const characterPatchDto = z.strictObject({ name: z.string().optional(), identity: nullableTextDto.optional(),
  personality: nullableTextDto.optional(), background: nullableTextDto.optional(), catchphrase: nullableTextDto.optional(),
  tags: z.array(z.string()).optional(), avatar_url: nullableTextDto.optional() });
const scenePatchDto = z.strictObject({ name: z.string().optional(), description: nullableTextDto.optional(),
  story_id: entityIdDto.nullable().optional(), order_index: signedIntegerDto.optional() });

export const storyWorkspaceCatalogWorkspaceInputDto = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("ensure") }),
  z.strictObject({ action: z.literal("patch"), workspace_id: entityIdDto, patch: workspacePatchDto }),
]);
export const storyWorkspaceCatalogWorkspaceResultDto = z.strictObject({
  action: z.enum(["ensure", "patch"]), item: storyWorkspaceCatalogWorkspaceDto,
});

export const storyWorkspaceCatalogPatchInputDto = z.discriminatedUnion("resource_type", [
  z.strictObject({ resource_type: z.literal("story"), resource_id: entityIdDto, patch: storyPatchDto }),
  z.strictObject({ resource_type: z.literal("character"), resource_id: entityIdDto, patch: characterPatchDto }),
  z.strictObject({ resource_type: z.literal("scene"), resource_id: entityIdDto, patch: scenePatchDto }),
]);
export const storyWorkspaceCatalogPatchResultDto = z.discriminatedUnion("resource_type", [
  z.strictObject({ resource_type: z.literal("story"), item: storyWorkspaceCatalogStoryDto }),
  z.strictObject({ resource_type: z.literal("character"), item: storyWorkspaceCatalogCharacterDto }),
  z.strictObject({ resource_type: z.literal("scene"), item: storyWorkspaceCatalogSceneDto }),
]);

export const storyWorkspaceCatalogOperationContracts = {
  "story-workspace-catalog.workspace": { kind: "write" as const, userScope: "dream:write",
    input: storyWorkspaceCatalogWorkspaceInputDto, output: storyWorkspaceCatalogWorkspaceResultDto },
  "story-workspace-catalog.read": { kind: "read" as const, userScope: "dream:read",
    input: storyWorkspaceCatalogReadInputDto, output: storyWorkspaceCatalogReadResultDto },
  "story-workspace-catalog.patch": { kind: "write" as const, userScope: "dream:write",
    input: storyWorkspaceCatalogPatchInputDto, output: storyWorkspaceCatalogPatchResultDto },
};

export type StoryWorkspaceCatalogReadInput = z.infer<typeof storyWorkspaceCatalogReadInputDto>;
export type StoryWorkspaceCatalogWorkspaceInput = z.infer<typeof storyWorkspaceCatalogWorkspaceInputDto>;
export type StoryWorkspaceCatalogPatchInput = z.infer<typeof storyWorkspaceCatalogPatchInputDto>;
export type StoryWorkspaceCatalogOperation = keyof typeof storyWorkspaceCatalogOperationContracts;
