// [Input] Owned workspace and original launch command fields without caller provenance.
// [Output] Closed registered ensure request and original source identifiers/time/fingerprint.
// [Pos] Launch source DTO boundary; Python boundary strip is validation, never normalization.
// [Sync] 2026-09-15: preserve Unicode codepoint limits and original ASCII business-key syntax.
import { z } from "zod";
import { dreamLaunchProtocolPolicy as policy } from "../../../config/dream-launch-policy";
import { isoTimeDto } from "../auth/dto";
import { stripPythonString } from "./deckPluginManifestDto";

const identifier = z.string().min(1).refine(value => value === stripPythonString(value) && Array.from(value).length <= policy.identifierMaxCharacters)
  .meta({ maxLength: policy.identifierMaxCharacters });
export const dreamLaunchCommandFields = {
  deck_id: identifier,
  agent_id: identifier.nullable(),
  goal: z.string().min(1).refine(value => value === stripPythonString(value) && Array.from(value).length <= policy.goalMaxCharacters)
    .meta({ maxLength: policy.goalMaxCharacters }),
  idempotency_key: identifier.regex(/^[A-Za-z0-9._:-]+$/),
};
export const dreamLaunchSourceEnsureInputDto = z.strictObject({ workspace_id: identifier, ...dreamLaunchCommandFields });
export const dreamLaunchSourceDto = z.strictObject({ thread_id: z.string().uuid(), message_id: z.string().uuid(),
  message_time: isoTimeDto, request_fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/), created: z.boolean() });
export const dreamLaunchSourceEnsureOutputDto = z.strictObject({ source: dreamLaunchSourceDto });
export const dreamLaunchSourceOperationContracts = {
  "dream-launch-source.ensure": { kind: "write" as const, input: dreamLaunchSourceEnsureInputDto,
    output: dreamLaunchSourceEnsureOutputDto, userScope: "dream:write" },
};
export type DreamLaunchSourceEnsureInput = z.output<typeof dreamLaunchSourceEnsureInputDto>;
export type DreamLaunchSource = z.output<typeof dreamLaunchSourceDto>;
