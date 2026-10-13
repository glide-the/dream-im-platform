// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] Server-bound persisted user turn and the model's structured image operation proposal.
// [Output] Closed image-only binding/selection facts and exact named API descriptors.
// [Pos] Original Dream operation protocol; user/service identity is derived by authentication.
// [Sync] 2026-10-10: distinguish semantic selection, actual source call and unique external execution.
import { z } from "zod";
import { createHash } from "node:crypto";
import { canonicalContractJson } from "./canonicalContractJson";

export function imageTurnReceiptKey(turnKey: string, discriminator = "") {
  return createHash("sha256").update(canonicalContractJson([turnKey, discriminator])).digest("hex");
}
export function imageTurnIdentityLockKey(serviceClientId: string, authSubject: string, turnKey: string) {
  return canonicalContractJson(["image-turn", serviceClientId, authSubject, turnKey]);
}

export const imageSelectionToolName = "mcp__image_gen__select_image_operation";
export const imageExecutionToolName = "mcp__image_gen__imagegen";
export const imageTurnKeyDto = z.string().regex(/^dream-turn-[0-9a-f]{64}$/);
export const imageCallIdDto = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);
export const imageDigestDto = z.string().regex(/^[0-9a-f]{64}$/);
const alias = z.string().min(1).max(120).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
export const imageReferenceUriDto = z.string().regex(/^workspace:\/\/files\/[^\s?#]+$/);
export const imageOperationDto = z.enum(["none", "unclear", "native_generate", "native_edit", "image_gen_generate", "image_gen_edit"]);
export const imageSelectionArgumentsDto = z.strictObject({
  operation: imageOperationDto,
  prompt: z.string().min(1).refine(value => value.trim().length > 0),
  reference_images: z.array(imageReferenceUriDto),
});
export const imageMaterialDto = z.strictObject({ uri: imageReferenceUriDto, sha256: imageDigestDto });
export const imageTurnBindInputDto = z.strictObject({
  thread_id: imageCallIdDto, turn_id: imageCallIdDto, turn_key: imageTurnKeyDto,
  message_id: imageCallIdDto, ai_model: alias, image_model: alias.nullable(),
  materials: z.array(imageMaterialDto),
});
export const imageTurnBindOutputDto = imageTurnBindInputDto.extend({ canonical_user_id: z.string().regex(/^[1-9][0-9]*$/), run_id: imageCallIdDto.nullable() });
export const imageTurnSelectInputDto = z.strictObject({
  thread_id: imageCallIdDto, turn_key: imageTurnKeyDto, source_call_id: imageCallIdDto,
  arguments: imageSelectionArgumentsDto,
});
export const imageTurnSelectOutputDto = z.strictObject({
  turn_key: imageTurnKeyDto, source_call_id: imageCallIdDto, operation: imageOperationDto,
  arguments_sha256: imageDigestDto, reference_images: z.array(imageReferenceUriDto),
});
export const nativeImageSummaryDto = z.strictObject({
  gatewayRequestId: z.string().regex(/^req_[0-9a-f]{32}$/), responseId: imageCallIdDto,
  providerHttpRequestId: imageCallIdDto.nullable(), configuredImageModel: z.string().min(1).max(200).nullable(),
  reportedImageModel: z.null(), usageKnown: z.literal(false), usageUnknownReason: z.literal("responses_image_usage_not_reported"),
  imageCalls: z.array(z.strictObject({ callId: imageCallIdDto, outputIndex: z.number().int().nonnegative(), status: z.literal("completed"),
    operation: z.enum(["generate", "edit"]), reportedAction: z.enum(["generate", "edit"]).nullable(), format: z.enum(["png", "jpeg", "webp"]),
    byteLength: z.number().int().positive(), sha256: imageDigestDto })).min(1),
});
export const imageTurnResultInputDto = z.strictObject({ thread_id: imageCallIdDto, turn_key: imageTurnKeyDto,
  gateway_request_id: z.string().regex(/^req_[0-9a-f]{32}$/), call_id: imageCallIdDto });
export const imageTurnOperationContracts = {
  "image-turn.bind": { kind: "write" as const, input: imageTurnBindInputDto, output: imageTurnBindOutputDto, userScope: "dream:write" },
  "image-turn.select": { kind: "write" as const, input: imageTurnSelectInputDto, output: imageTurnSelectOutputDto, userScope: "dream:write" },
  "image-turn.result": { kind: "read" as const, input: imageTurnResultInputDto, output: nativeImageSummaryDto, userScope: "dream:write" },
};
export type ImageTurnBinding = z.infer<typeof imageTurnBindOutputDto>;
export type ImageTurnSelection = z.infer<typeof imageTurnSelectOutputDto>;
export type ImageSelectionArguments = z.infer<typeof imageSelectionArgumentsDto>;
export type ImageTurnOperation = keyof typeof imageTurnOperationContracts;

export const imageSourceDto = z.strictObject({
  call_id: imageCallIdDto, output_item_id: imageCallIdDto.nullable(),
  gateway_request_id: z.string().regex(/^req_[0-9a-f]{32}$/),
  tool_name: z.enum([imageSelectionToolName, imageExecutionToolName]), arguments_sha256: imageDigestDto,
});
export const imageExecutionClaimDto = z.strictObject({
  gateway_request_id: z.string().regex(/^req_[0-9a-f]{32}$/),
  operation: z.enum(["native_generate", "native_edit", "image_gen_generate", "image_gen_edit"]),
  selected_model: alias, selection_call_id: imageCallIdDto,
});
