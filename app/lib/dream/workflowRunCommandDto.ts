// [Input] Exact Run/workspace and named start/fail/cancel business facts; no target-status patch or actor.
// [Output] Full authoritative Run after the original atomic lifecycle command.
// [Pos] Narrow Workflow mutation contract; output/readiness authority remains server-owned.
// [Sync] 2026-09-15: keep failure strings' original truthiness and separate physical start requirements.
import { z } from "zod";
import { workflowRunLookupInputDto, workflowRunReadOutputDto } from "./workflowRunDto";

export const workflowRunStartInputDto = workflowRunLookupInputDto.extend({
  runtime_load_receipt_id: z.string().min(1), agent_session_id: z.string().regex(/^as_[0-9a-f]{32}$/), reason_code: z.string().nullable(),
});
export const workflowRunFailInputDto = workflowRunLookupInputDto.extend({ failed_step: z.string().min(1), error_code: z.string().min(1), reason_code: z.string().nullable() });
export const workflowRunCancelInputDto = workflowRunLookupInputDto.extend({ reason_code: z.string().nullable() });
export const workflowRunCommandOperationContracts = {
  "workflow-run.start": { kind: "write" as const, input: workflowRunStartInputDto, output: workflowRunReadOutputDto, userScope: "dream:write" },
  "workflow-run.fail": { kind: "write" as const, input: workflowRunFailInputDto, output: workflowRunReadOutputDto, userScope: "dream:write" },
  "workflow-run.cancel": { kind: "write" as const, input: workflowRunCancelInputDto, output: workflowRunReadOutputDto, userScope: "dream:write" },
};
export type WorkflowRunCommandOperation = keyof typeof workflowRunCommandOperationContracts;
export type WorkflowRunStartInput = z.infer<typeof workflowRunStartInputDto>;
