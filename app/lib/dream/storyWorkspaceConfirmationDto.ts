// [Input] Lossless canonical Dream confirmation command or exact background claim identity.
// [Output] Strict Registry120 OAuth/background DTOs with server-derived durable dispatch facts.
// [Pos] Cross-project contract; no actor override, SQL, table, transaction or Runtime selector.
// [Sync] 2026-09-16: define the complete Story Workspace confirmation persistence state machine.
import { z } from "zod";
import { decimalIdDto, requestIdDto } from "../auth/dto";
import { stripPydanticString } from "./deckPluginManifestDto";
import { workflowRunIdDto } from "./workflowRunDto";

const text = z.string().overwrite(stripPydanticString);
const codePoints = (value: string, maximum: number) => Array.from(value).length <= maximum;
const identifier = (maximum: number) => text.min(1).refine(value => codePoints(value, maximum));
export const storyWorkspaceConfirmationMessageIdDto = z.string().regex(/^dream_confirm_[0-9a-f]{64}$/);
export const storyWorkspaceConfirmationClaimIdDto = requestIdDto;
const hashDto = z.string().regex(/^sha256:[0-9a-f]{64}$/);
const stageDto = z.enum(["characters", "scenes", "storyboards"]);
const baseRevisionsDto = z.strictObject({
  characters: z.number().int().positive().safe(),
  scenes: z.number().int().positive().safe(),
  storyboards: z.number().int().positive().safe(),
});
const editFieldsDto = z.strictObject({
  displayName: identifier(200).optional(),
  summary: text.refine(value => codePoints(value, 4_000)).nullable().optional(),
  relations: z.array(identifier(128)).max(100).optional(),
}).refine(value => Object.keys(value).length > 0);
export const storyWorkspaceConfirmationCommandDto = z.strictObject({
  storyWorkspaceRunId: workflowRunIdDto,
  threadId: identifier(255),
  baseRevisions: baseRevisionsDto,
  edits: z.array(z.strictObject({
    stage: stageDto,
    entityId: identifier(128),
    fields: editFieldsDto,
  })).max(1_000),
  idempotencyKey: text.regex(/^swc_[A-Za-z0-9._:-]+$/).min(5).max(255),
});

export const storyWorkspaceConfirmationSubmitInputDto = z.strictObject({
  command_json: z.string().min(1),
});
export const storyWorkspaceConfirmationFactInputDto = z.strictObject({
  workflow_run_id: workflowRunIdDto,
});
export const storyWorkspaceConfirmationClaimInputDto = z.strictObject({
  message_id: storyWorkspaceConfirmationMessageIdDto.nullable(),
  claim_id: storyWorkspaceConfirmationClaimIdDto,
});
export const storyWorkspaceConfirmationLeaseInputDto = z.strictObject({
  message_id: storyWorkspaceConfirmationMessageIdDto,
  claim_id: storyWorkspaceConfirmationClaimIdDto,
  duration_seconds: z.number().nonnegative().finite().nullable(),
});
export const storyWorkspaceConfirmationAckInputDto = z.strictObject({
  message_id: storyWorkspaceConfirmationMessageIdDto,
  claim_id: storyWorkspaceConfirmationClaimIdDto,
});

export const storyWorkspaceConfirmationMetadataDto = z.strictObject({
  kind: z.literal("story-workspace-dream-confirmation"),
  actor: decimalIdDto,
  story_workspace_run_id: workflowRunIdDto,
  thread_id: identifier(255),
  base_revisions: baseRevisionsDto,
  edit_count: z.number().int().nonnegative().safe(),
  command_fingerprint: hashDto,
  idempotency_key: storyWorkspaceConfirmationCommandDto.shape.idempotencyKey,
  request_id: requestIdDto,
  dispatch_status: z.enum(["pending", "dispatching", "dispatched"]),
  dispatch_claim_id: storyWorkspaceConfirmationClaimIdDto.optional(),
  dispatch_claim_lease_until: z.number().nonnegative().finite().optional(),
  dispatch_ack_claim_sha256: hashDto.optional(),
}).superRefine((value, context) => {
  const claiming = value.dispatch_status === "dispatching";
  if (claiming !== (value.dispatch_claim_id !== undefined && value.dispatch_claim_lease_until !== undefined)) {
    context.addIssue({ code: "custom", message: "Dispatching metadata requires one complete claim." });
  }
  if ((value.dispatch_status === "dispatched") !== (value.dispatch_ack_claim_sha256 !== undefined)) {
    context.addIssue({ code: "custom", message: "Dispatched metadata requires one acknowledgement hash." });
  }
});
export const storyWorkspaceConfirmationDispatchDto = z.strictObject({
  thread_id: identifier(255),
  actor_id: decimalIdDto,
  message_id: storyWorkspaceConfirmationMessageIdDto,
  parts_json: z.string().min(1),
  metadata_json: z.string().min(1),
});
export const storyWorkspaceConfirmationSubmitOutputDto = z.strictObject({
  message_id: storyWorkspaceConfirmationMessageIdDto,
  story_workspace_run_id: workflowRunIdDto,
  thread_id: identifier(255),
  status: z.literal("accepted"),
  replayed: z.boolean(),
  dispatched: z.boolean(),
  request_id: requestIdDto,
  dispatch: storyWorkspaceConfirmationDispatchDto.nullable(),
});
export const storyWorkspaceConfirmationFactOutputDto = z.strictObject({
  workflow_run_id: workflowRunIdDto,
  thread_id: identifier(255),
  confirmation_accepted: z.boolean(),
  confirmation_dispatched: z.boolean(),
}).refine(value => !value.confirmation_dispatched || value.confirmation_accepted);
export const storyWorkspaceConfirmationClaimOutputDto = z.strictObject({
  dispatch: storyWorkspaceConfirmationDispatchDto.nullable(),
});
export const storyWorkspaceConfirmationLeaseOutputDto = z.strictObject({
  renewed: z.boolean(),
  lease_until: z.number().nonnegative().finite().nullable(),
});
export const storyWorkspaceConfirmationAckOutputDto = z.strictObject({ acked: z.boolean() });

export const storyWorkspaceConfirmationOperationContracts = {
  "story-workspace-confirmation.submit": { audience: "oauth" as const, kind: "write" as const, userScope: "dream:write", input: storyWorkspaceConfirmationSubmitInputDto, output: storyWorkspaceConfirmationSubmitOutputDto },
  "story-workspace-confirmation.fact": { audience: "oauth" as const, kind: "read" as const, userScope: "dream:read", input: storyWorkspaceConfirmationFactInputDto, output: storyWorkspaceConfirmationFactOutputDto },
  "story-workspace-confirmation.claim": { audience: "background" as const, kind: "write" as const, backgroundScope: "story-confirmation:dispatch", input: storyWorkspaceConfirmationClaimInputDto, output: storyWorkspaceConfirmationClaimOutputDto },
  "story-workspace-confirmation.lease": { audience: "background" as const, kind: "write" as const, backgroundScope: "story-confirmation:dispatch", input: storyWorkspaceConfirmationLeaseInputDto, output: storyWorkspaceConfirmationLeaseOutputDto },
  "story-workspace-confirmation.ack": { audience: "background" as const, kind: "write" as const, backgroundScope: "story-confirmation:dispatch", input: storyWorkspaceConfirmationAckInputDto, output: storyWorkspaceConfirmationAckOutputDto },
};
export type StoryWorkspaceConfirmationOperation = keyof typeof storyWorkspaceConfirmationOperationContracts;
export type StoryWorkspaceConfirmationOAuthOperation = "story-workspace-confirmation.submit" | "story-workspace-confirmation.fact";
export type StoryWorkspaceConfirmationBackgroundOperation = Exclude<StoryWorkspaceConfirmationOperation, StoryWorkspaceConfirmationOAuthOperation>;
export type StoryWorkspaceConfirmationCommand = z.infer<typeof storyWorkspaceConfirmationCommandDto>;
export type StoryWorkspaceConfirmationMetadata = z.infer<typeof storyWorkspaceConfirmationMetadataDto>;
export type StoryWorkspaceConfirmationDispatch = z.infer<typeof storyWorkspaceConfirmationDispatchDto>;
export type StoryWorkspaceConfirmationSubmitOutput = z.infer<typeof storyWorkspaceConfirmationSubmitOutputDto>;
export type StoryWorkspaceConfirmationFactOutput = z.infer<typeof storyWorkspaceConfirmationFactOutputDto>;
export type StoryWorkspaceConfirmationClaimOutput = z.infer<typeof storyWorkspaceConfirmationClaimOutputDto>;
export type StoryWorkspaceConfirmationLeaseOutput = z.infer<typeof storyWorkspaceConfirmationLeaseOutputDto>;
export type StoryWorkspaceConfirmationAckOutput = z.infer<typeof storyWorkspaceConfirmationAckOutputDto>;
