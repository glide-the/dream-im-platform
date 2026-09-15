// [Input] Source Thread plus one Dream-validated standalone Story proposal.
// [Output] Strict pending-review Story, Character, Scene and source Deck projection.
// [Pos] Registry109 DTO; actor, Workspace, database and transaction identities stay server-derived.
// [Sync] 2026-09-15: define the atomic Story Workspace output persistence contract.
import { z } from "zod";

const entityId = z.string().min(1).max(255);
const nullableText = z.string().nullable();
const postgresInteger = z.number().int().min(-2_147_483_648).max(2_147_483_647);

export const storyWorkspaceOutputCharacterDto = z.strictObject({
  name: z.string().trim().min(1),
  identity: nullableText,
  personality: nullableText,
  background: nullableText,
  catchphrase: nullableText,
  tags: z.array(z.string()),
});

export const storyWorkspaceOutputSceneDto = z.strictObject({
  name: z.string().trim().min(1),
  description: nullableText,
  order_index: postgresInteger,
});

export const storyWorkspaceOutputStoryDto = z.strictObject({
  title: z.string().trim().min(1),
  description: nullableText,
  type: z.enum(["short", "long", "script", "outline"]),
  content: nullableText,
  characters: z.array(storyWorkspaceOutputCharacterDto),
  scenes: z.array(storyWorkspaceOutputSceneDto),
}).superRefine((value, context) => {
  const names = new Set<string>();
  value.characters.forEach((item, index) => {
    if (names.has(item.name)) context.addIssue({ code: "custom", path: ["characters", index, "name"], message: "Character names must be unique" });
    names.add(item.name);
  });
  const orders = new Set<number>();
  value.scenes.forEach((item, index) => {
    if (orders.has(item.order_index)) context.addIssue({ code: "custom", path: ["scenes", index, "order_index"], message: "Scene order_index values must be unique" });
    orders.add(item.order_index);
  });
});

export const storyWorkspaceOutputInputDto = z.strictObject({
  thread_id: entityId,
  story: storyWorkspaceOutputStoryDto,
});

export const storyWorkspaceOutputResultDto = z.strictObject({
  story_id: entityId,
  review_status: z.literal("pending"),
  character_ids: z.array(entityId),
  scene_ids: z.array(entityId),
  chat_thread_id: entityId,
  deck_id: entityId.nullable(),
  deck_name: nullableText,
  deck_name_zh: nullableText,
  deck_name_en: nullableText,
});

export const storyWorkspaceOutputOperationContracts = {
  "story-workspace-output.store": {
    kind: "write" as const,
    userScope: "dream:write",
    input: storyWorkspaceOutputInputDto,
    output: storyWorkspaceOutputResultDto,
  },
};

export type StoryWorkspaceOutputInput = z.infer<typeof storyWorkspaceOutputInputDto>;
export type StoryWorkspaceOutputResult = z.infer<typeof storyWorkspaceOutputResultDto>;
export type StoryWorkspaceOutputOperation = keyof typeof storyWorkspaceOutputOperationContracts;
