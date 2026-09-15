// [Input] One authenticated Dream Story Workspace review command with closed resource/action values.
// [Output] Explicit browser-safe Story, Character or Scene projections and ordered batch accounting.
// [Pos] Registry111 DTO boundary; actor, ORM entity, table, column and transaction identities stay server-derived.
// [Sync] 2026-09-15: define atomic single and batch Dream product-review contracts.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";

const entityId = z.string().trim().min(1).max(255);
const nullableText = z.string().nullable();
const safeNonnegativeInteger = z.number().int().safe().nonnegative();
const reviewNotes = z.string().max(2_000).nullable();
export const storyWorkspaceReviewResourceTypeDto = z.enum(["story", "character", "scene"]);
export const storyWorkspaceReviewActionDto = z.enum(["confirm", "reject", "archive"]);

export const storyWorkspaceReviewStoryDto = z.strictObject({
  id: entityId,
  identifier: z.string(),
  title: z.string(),
  description: nullableText,
  status: z.enum(["draft", "published", "archived"]),
  review_status: z.enum(["pending", "confirmed", "rejected"]),
  review_notes: nullableText,
  type: z.enum(["short", "long", "script", "outline"]),
  character_count: safeNonnegativeInteger,
  scene_count: safeNonnegativeInteger,
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  confirmed_at: isoTimeDto.nullable(),
  source_run_id: nullableText,
  source_project_id: nullableText,
  episode_count: safeNonnegativeInteger.nullable(),
  artifact_status: z.enum(["generating", "available", "missing", "invalid"]).nullable(),
  artifact_manifest_revision: nullableText,
  script_revision: nullableText,
  artifact_sync_status: z.enum(["syncing", "indexed", "stale", "failed"]).nullable(),
  artifact_indexed_at: isoTimeDto.nullable(),
  artifact_sync_error_code: z.enum([
    "story_index_row_missing", "story_index_schema_unavailable", "story_index_database_unavailable",
    "story_index_write_failed", "story_index_conflict", "story_index_invalid_artifact",
    "story_index_revision_conflict", "artifact_missing",
  ]).nullable(),
  script_size_bytes: safeNonnegativeInteger.nullable(),
  artifact_available: z.boolean().nullable(),
  reconcile_version: safeNonnegativeInteger.nullable(),
});

export const storyWorkspaceReviewCharacterDto = z.strictObject({
  id: entityId,
  identifier: z.string(),
  name: z.string(),
  avatar_url: nullableText,
  identity: nullableText,
  personality: nullableText,
  background: nullableText,
  catchphrase: nullableText,
  tags: z.array(z.string()),
  story_count: safeNonnegativeInteger,
  review_status: z.enum(["pending", "confirmed", "rejected"]),
  review_notes: nullableText,
  status: z.enum(["active", "archived"]),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  confirmed_at: isoTimeDto.nullable(),
  archived_at: isoTimeDto.nullable(),
});

export const storyWorkspaceReviewSceneDto = z.strictObject({
  id: entityId,
  identifier: z.string(),
  name: z.string(),
  description: nullableText,
  story_id: entityId.nullable(),
  character_count: safeNonnegativeInteger,
  order_index: z.number().int().min(-2_147_483_648).max(2_147_483_647),
  review_status: z.enum(["pending", "confirmed", "rejected"]),
  review_notes: nullableText,
  status: z.enum(["active", "archived"]),
  created_at: isoTimeDto,
  updated_at: isoTimeDto,
  confirmed_at: isoTimeDto.nullable(),
  archived_at: isoTimeDto.nullable(),
});

const storyTransitionInput = z.strictObject({
  resource_type: z.literal("story"), resource_id: entityId,
  action: storyWorkspaceReviewActionDto, review_notes: reviewNotes,
});
const characterTransitionInput = z.strictObject({
  resource_type: z.literal("character"), resource_id: entityId,
  action: z.enum(["confirm", "reject"]), review_notes: reviewNotes,
});
const sceneTransitionInput = z.strictObject({
  resource_type: z.literal("scene"), resource_id: entityId,
  action: z.enum(["confirm", "reject"]), review_notes: reviewNotes,
});
export const storyWorkspaceReviewTransitionInputDto = z.discriminatedUnion("resource_type", [
  storyTransitionInput, characterTransitionInput, sceneTransitionInput,
]);

export const storyWorkspaceReviewTransitionResultDto = z.discriminatedUnion("resource_type", [
  z.strictObject({ resource_type: z.literal("story"), item: storyWorkspaceReviewStoryDto }),
  z.strictObject({ resource_type: z.literal("character"), item: storyWorkspaceReviewCharacterDto }),
  z.strictObject({ resource_type: z.literal("scene"), item: storyWorkspaceReviewSceneDto }),
]);

const uniqueIds = z.array(entityId).min(1).max(100).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "ids must contain unique values" });
});
export const storyWorkspaceReviewBatchInputDto = z.strictObject({
  resource_type: storyWorkspaceReviewResourceTypeDto,
  ids: uniqueIds,
  action: storyWorkspaceReviewActionDto,
  review_notes: reviewNotes,
});

const batchFields = {
  success: z.literal(true), action: storyWorkspaceReviewActionDto,
  total_requested: z.number().int().min(1).max(100),
  total_updated: z.number().int().min(0).max(100),
  skipped_ids: z.array(entityId),
};
export const storyWorkspaceReviewBatchResultDto = z.discriminatedUnion("resource_type", [
  z.strictObject({ ...batchFields, resource_type: z.literal("story"), updated_items: z.array(storyWorkspaceReviewStoryDto) }),
  z.strictObject({ ...batchFields, resource_type: z.literal("character"), updated_items: z.array(storyWorkspaceReviewCharacterDto) }),
  z.strictObject({ ...batchFields, resource_type: z.literal("scene"), updated_items: z.array(storyWorkspaceReviewSceneDto) }),
]);

export const storyWorkspaceReviewOperationContracts = {
  "story-workspace-review.transition": {
    kind: "write" as const, userScope: "dream:write",
    input: storyWorkspaceReviewTransitionInputDto, output: storyWorkspaceReviewTransitionResultDto,
  },
  "story-workspace-review.batch": {
    kind: "write" as const, userScope: "dream:write",
    input: storyWorkspaceReviewBatchInputDto, output: storyWorkspaceReviewBatchResultDto,
  },
};

export type StoryWorkspaceReviewResourceType = z.infer<typeof storyWorkspaceReviewResourceTypeDto>;
export type StoryWorkspaceReviewAction = z.infer<typeof storyWorkspaceReviewActionDto>;
export type StoryWorkspaceReviewTransitionInput = z.infer<typeof storyWorkspaceReviewTransitionInputDto>;
export type StoryWorkspaceReviewBatchInput = z.infer<typeof storyWorkspaceReviewBatchInputDto>;
export type StoryWorkspaceReviewOperation = keyof typeof storyWorkspaceReviewOperationContracts;
