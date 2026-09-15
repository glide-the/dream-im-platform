// [Input] Owned workspace and original launch command fields without caller provenance.
// [Output] Closed ensure/replay requests and original source/Run identifiers.
// [Pos] Launch source DTO boundary; Python boundary strip is validation, never normalization.
// [Sync] 2026-09-16: add actor-derived idempotent replay lookup without caller selectors.
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
export const dreamLaunchReplayDto = z.strictObject({
  workflow_run_id: z.string().regex(/^run_[0-9a-f]{32}$/),
  workflow_preflight_id: z.string().regex(/^pf_[0-9a-f]{32}$/),
  thread_id: z.string().uuid(),
  message_id: z.string().uuid(),
});
export const dreamLaunchReplayLookupOutputDto = z.strictObject({ replay: dreamLaunchReplayDto.nullable() });
export const dreamLaunchSourceOperationContracts = {
  "dream-launch-source.ensure": { kind: "write" as const, input: dreamLaunchSourceEnsureInputDto,
    output: dreamLaunchSourceEnsureOutputDto, userScope: "dream:write" },
};
// Kept separate so Registry133 appends without changing the frozen Registry132 prefix.
export const dreamLaunchReplayOperationContracts = {
  "dream-launch-replay.lookup": { kind: "read" as const, input: dreamLaunchSourceEnsureInputDto,
    output: dreamLaunchReplayLookupOutputDto, userScope: "dream:read" },
};
export type DreamLaunchSourceEnsureInput = z.output<typeof dreamLaunchSourceEnsureInputDto>;
export type DreamLaunchSource = z.output<typeof dreamLaunchSourceDto>;
export type DreamLaunchReplayOperation = keyof typeof dreamLaunchReplayOperationContracts;
