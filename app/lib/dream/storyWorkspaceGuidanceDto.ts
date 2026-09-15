// [Input] Actor-free Story Workspace Run guidance command and Admin-derived persistence facts.
// [Output] Strict Registry115 command/result plus new-only same-Thread dispatch envelope.
// [Pos] Cross-project DTO; actor, Workspace, Thread, message identity and transaction stay Admin-derived.
// [Sync] 2026-09-15: define the Story Workspace guidance DTO/ORM boundary.
import { z } from "zod";
import { requestIdDto, decimalIdDto } from "../auth/dto";
import { stripPydanticString } from "./deckPluginManifestDto";
import { workflowRunIdDto } from "./workflowRunDto";

const text = z.string().overwrite(stripPydanticString);
const codePointMax = (value: string, maximum: number) => Array.from(value).length <= maximum;
const nonemptyText = (maximum: number) => text.min(1).refine(value => codePointMax(value, maximum));
const nullableText = text.refine(value => codePointMax(value, 4_000)).nullable();
const hashDto = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const messageIdDto = z.string().min(1).max(512);

export const storyWorkspaceGuidanceInputDto = z.strictObject({
  workflow_run_id: workflowRunIdDto,
  kind: z.enum(["retry-step", "free-text"]),
  text: nullableText,
  step_id: nonemptyText(128).nullable(),
  idempotency_key: nonemptyText(255),
}).superRefine((value, context) => {
  if (value.kind === "free-text" && (value.text === null || value.text.length === 0)) {
    context.addIssue({ code: "custom", path: ["text"], message: "free-text guidance requires non-blank text" });
  }
  if (value.kind === "retry-step" && value.step_id === null) {
    context.addIssue({ code: "custom", path: ["step_id"], message: "retry-step guidance requires step_id" });
  }
});

export const storyWorkspaceGuidanceMetadataDto = z.strictObject({
  kind: z.literal("story-workspace-guidance"),
  story_workspace_run_id: workflowRunIdDto,
  actor: decimalIdDto,
  request_id: requestIdDto,
  idempotency_key: nonemptyText(255),
  command_kind: z.enum(["retry-step", "free-text"]),
  step_id: nonemptyText(128).nullable(),
  text_summary: text.refine(value => codePointMax(value, 200)),
  review_action: z.literal("guide"),
  command_fingerprint: hashDto,
});

export const storyWorkspaceGuidanceDispatchDto = z.strictObject({
  thread_id: z.string().min(1).max(255),
  message_id: messageIdDto,
  parts: z.array(z.strictObject({ type: z.literal("text"), text: z.string() })).length(1),
  metadata: storyWorkspaceGuidanceMetadataDto,
});

export const storyWorkspaceGuidanceResultDto = z.strictObject({
  message_id: messageIdDto,
  story_workspace_run_id: workflowRunIdDto,
  review_action: z.literal("guide"),
  status: z.literal("accepted"),
  replayed: z.boolean(),
  request_id: requestIdDto,
  dispatch: storyWorkspaceGuidanceDispatchDto.nullable(),
});

export const storyWorkspaceGuidanceOperationContracts = {
  "story-workspace-guidance.submit": {
    kind: "write" as const,
    userScope: "dream:write",
    input: storyWorkspaceGuidanceInputDto,
    output: storyWorkspaceGuidanceResultDto,
  },
};

export type StoryWorkspaceGuidanceInput = z.infer<typeof storyWorkspaceGuidanceInputDto>;
export type StoryWorkspaceGuidanceMetadata = z.infer<typeof storyWorkspaceGuidanceMetadataDto>;
export type StoryWorkspaceGuidanceResult = z.infer<typeof storyWorkspaceGuidanceResultDto>;
export type StoryWorkspaceGuidanceOperation = keyof typeof storyWorkspaceGuidanceOperationContracts;
