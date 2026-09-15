// [Input] Owned Run lookup, Dream-computed instruction text or issued claim/accepted outcome.
// [Output] Closed claim/finish results and server-derived original ten-field context.
// [Pos] Registered launch metadata boundary; no actor/context/metadata/status patch is accepted.
// [Sync] 2026-09-15: preserve Pydantic whitespace and codepoint limits independently of frozen context DTO.
import { z } from "zod";
import { dreamLaunchProtocolPolicy as policy } from "../../../config/dream-launch-policy";
import { workflowRunLookupInputDto } from "./workflowRunDto";
import { stripPydanticString } from "./deckPluginManifestDto";

const contextId = z.string().overwrite(stripPydanticString).min(1)
  .refine(value => Array.from(value).length <= policy.identifierMaxCharacters).meta({ maxLength: policy.identifierMaxCharacters });
export const dreamLaunchDispatchContextDto = z.strictObject({ workflow_run_id: z.string().regex(/^run_[0-9a-f]{32}$/),
  thread_id: contextId, deck_id: contextId, agent_id: contextId.nullable().default(null), deck_plugin_id: contextId, deck_plugin_version: contextId,
  deck_plugin_binding_id: contextId, binding_revision: z.number().int().positive().safe(), deck_runtime_snapshot_id: contextId, runtime_plugin_lock_id: contextId });
const claimIdDto = z.string().regex(/^dlc_[0-9a-f]{32}$/);
export const dreamLaunchDispatchClaimInputDto = workflowRunLookupInputDto.extend({ instruction_text: z.string().min(1) });
export const dreamLaunchDispatchFinishInputDto = workflowRunLookupInputDto.extend({ claim_id: claimIdDto, accepted: z.boolean() });
const sourceFields = { workflow_run_id: z.string().regex(/^run_[0-9a-f]{32}$/), thread_id: z.string().uuid(), message_id: z.string().uuid() };
export const dreamLaunchDispatchClaimOutputDto = z.discriminatedUnion("claimed", [
  z.strictObject({ claimed: z.literal(false), ...sourceFields }),
  z.strictObject({ claimed: z.literal(true), ...sourceFields, claim_id: claimIdDto, context: dreamLaunchDispatchContextDto,
    parts_json: z.string(), metadata_json: z.string() }),
]);
export const dreamLaunchDispatchFinishOutputDto = z.strictObject({ finished: z.boolean(), ...sourceFields });
export const dreamLaunchDispatchOperationContracts = {
  "dream-launch-dispatch.claim": { kind: "write" as const, input: dreamLaunchDispatchClaimInputDto, output: dreamLaunchDispatchClaimOutputDto, userScope: "dream:write" },
  "dream-launch-dispatch.finish": { kind: "write" as const, input: dreamLaunchDispatchFinishInputDto, output: dreamLaunchDispatchFinishOutputDto, userScope: "dream:write" },
};
export type DreamLaunchDispatchOperation = keyof typeof dreamLaunchDispatchOperationContracts;
