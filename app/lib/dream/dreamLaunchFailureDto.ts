// [Input] Owned workspace/Run and the original truthy terminal error string.
// [Output] Bounded failure-envelope completion with original error and server-derived source identifiers.
// [Pos] Registered77 fixed failure boundary; no actor/source/status/context/metadata patch.
// [Sync] 2026-09-15: advertise the original truthy error for immutable-input receipt recovery.
import { z } from "zod";
import { workflowRunLookupInputDto, workflowRunIdDto } from "./workflowRunDto";
export const dreamLaunchFailureEnvelopeInputDto = workflowRunLookupInputDto.extend({ error_code: z.string().min(1) });
export const dreamLaunchFailureEnvelopeOutputDto = z.strictObject({ updated: z.boolean(), workflow_run_id: workflowRunIdDto,
  thread_id: z.string().nullable(), message_id: z.string().nullable(), error_code: z.string().min(1) });
export const dreamLaunchFailureOperationContracts = {
  "dream-launch-failure.envelope": { kind: "write" as const, input: dreamLaunchFailureEnvelopeInputDto, output: dreamLaunchFailureEnvelopeOutputDto, userScope: "dream:write" },
};
