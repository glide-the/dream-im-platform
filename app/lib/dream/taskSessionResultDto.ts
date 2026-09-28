// [Input] Admin-owned task/result identities and trusted Dream delivery observations.
// [Output] Closed completion, claim, settlement and source-card operation shapes.
// [Pos] Task result wire contract; actor, session and process identity are server-derived.
// [Sync] 2026-09-27: include service-only global recovery and claim-bound dual grants.
// [Sync] 2026-09-27: bind each result to one completed target turn and one source claim.
import { z } from "zod";
import { decimalIdDto, isoTimeDto } from "../auth/dto";
import { delegationOutputDto } from "../auth/delegationDto";

const id = z.string().min(1).max(255);
const revision = z.number().int().positive().safe();
const errorCode = z.enum([
  "TASK_SESSION_RETURN_NOT_SUBMITTED", "TASK_SESSION_RETURN_OWNER_UNKNOWN",
  "TASK_SESSION_RETURN_STATE_UNKNOWN", "TASK_SESSION_RETURN_PERSISTENCE_FAILED",
]);
export const taskResultDto = z.strictObject({
  notification_id: id, task_id: id, source_thread_id: id, target_thread_id: id,
  target_turn_id: id, target_final_message_id: id, title: z.string(),
  final_text: z.string().min(1), status: z.enum(["pending", "dispatching", "delivered", "failed", "state_unknown"]),
  revision, claim_id: id.nullable(), source_turn_id: id.nullable(),
  source_input_message_id: id.nullable(),
  source_final_message_id: id.nullable(), error_code: errorCode.nullable(),
  created_at: isoTimeDto, updated_at: isoTimeDto,
});
export const resultCommitInputDto = z.strictObject({
  target_thread_id: id, target_turn_id: id, target_final_message_id: id,
});
export const resultListInputDto = z.strictObject({ source_thread_id: id });
export const resultClaimInputDto = z.strictObject({ notification_id: id, expected_revision: revision, source_turn_id: id });
export const resultClaimNextInputDto = z.strictObject({});
export const resultSettleInputDto = z.discriminatedUnion("action", [
  z.strictObject({ notification_id: id, expected_revision: revision, claim_id: id, action: z.literal("delivered") }),
  z.strictObject({ notification_id: id, expected_revision: revision, claim_id: id, action: z.literal("failed"), error_code: z.literal("TASK_SESSION_RETURN_NOT_SUBMITTED") }),
  z.strictObject({ notification_id: id, expected_revision: revision, claim_id: id, action: z.literal("mark_unknown"), error_code: errorCode.exclude(["TASK_SESSION_RETURN_NOT_SUBMITTED"]) }),
]);
export const resultCommitOutputDto = z.strictObject({ result: taskResultDto.nullable() });
export const resultListOutputDto = z.strictObject({ results: z.array(taskResultDto) });
export const resultClaimOutputDto = z.strictObject({ result: taskResultDto, actor_id: decimalIdDto, source_session_id: id,
  source_input_message_id: id, source_input_text: z.string().min(1),
  source_persistence_authorization: delegationOutputDto, source_gateway_authorization: delegationOutputDto });
export const resultClaimNextOutputDto = z.strictObject({ claim: resultClaimOutputDto.nullable() });
export const resultSettleOutputDto = z.strictObject({ result: taskResultDto });
export const taskSessionResultContracts = {
  "task-session.result-commit": { kind: "write", audience: "user", input: resultCommitInputDto, output: resultCommitOutputDto, userScope: "dream:write", backgroundScope: null },
  "task-session.result-list": { kind: "read", audience: "user", input: resultListInputDto, output: resultListOutputDto, userScope: "dream:read", backgroundScope: null },
  "task-session.result-claim": { kind: "write", audience: "background", input: resultClaimInputDto, output: resultClaimOutputDto, userScope: null, backgroundScope: "task-return:dispatch" },
  "task-session.result-settle": { kind: "write", audience: "background", input: resultSettleInputDto, output: resultSettleOutputDto, userScope: null, backgroundScope: "task-return:dispatch" },
  "task-session.result-claim-next": { kind: "write", audience: "background", input: resultClaimNextInputDto, output: resultClaimNextOutputDto, userScope: null, backgroundScope: "task-return:dispatch" },
} as const;
export type TaskSessionResultOperation = keyof typeof taskSessionResultContracts;
