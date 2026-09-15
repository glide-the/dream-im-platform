// [Input] Owned workspace, original Preflight/token, business key and optional complete Voice source.
// [Output] Closed create/retry requests; release, actor, lifecycle and hashes stay server-derived.
// [Pos] Original Run creation protocol; shared stored key rules retain separate explicit request blank checks.
// [Sync] 2026-09-15: reuse corrected codepoint key without changing old output schemas or source-time semantics.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { stripPydanticString, stripPythonString } from "./deckPluginManifestDto";
import { workflowRunIdDto, workflowRunKeyDto, workflowRunReadOutputDto } from "./workflowRunDto";

const text = z.string().overwrite(stripPydanticString);
const identifier = text.min(1);
export const workflowRunCreationKeyDto = workflowRunKeyDto.refine(value => stripPythonString(value) !== "");
const common = { workspace_id: identifier, workflow_preflight_id: text.regex(/^pf_[0-9a-f]{32}$/),
  preflight_token: identifier, idempotency_key: workflowRunCreationKeyDto };
export const workflowRunCreateInputDto = z.strictObject({ ...common, source_voice_thread_id: text.nullable(),
  source_message_id: text.nullable(), source_message_time: isoTimeDto.nullable() }).refine(input => {
    const count = [input.source_voice_thread_id, input.source_message_id, input.source_message_time].filter(value => value !== null).length;
    return count === 0 || count === 3;
  }, "Voice source requires the complete thread, message and aware time tuple.");
export const workflowRunRetryInputDto = z.strictObject({ ...common, workflow_run_id: workflowRunIdDto });
export const workflowRunCreationOperationContracts = {
  "workflow-run.create": { kind: "write" as const, input: workflowRunCreateInputDto, output: workflowRunReadOutputDto, userScope: "dream:write" },
  "workflow-run.retry": { kind: "write" as const, input: workflowRunRetryInputDto, output: workflowRunReadOutputDto, userScope: "dream:write" },
};
export type WorkflowRunCreateInput = z.output<typeof workflowRunCreateInputDto>;
export type WorkflowRunRetryInput = z.output<typeof workflowRunRetryInputDto>;
export type WorkflowRunCreationOperation = keyof typeof workflowRunCreationOperationContracts;
