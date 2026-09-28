// [Input] Explicit once/daily user settings, expected revision and service-only trigger commands.
// [Output] Closed owner-scoped schedule, date, history and dispatch DTO contracts.
// [Pos] Named Admin scheduled Chat operation contract; no actor, SQL, path or credential selectors.
// [Sync] 2026-09-28: define one effective revision and durable trigger states for first-phase scheduling.
import { z } from "zod";
import { isoTimeDto, requestIdDto } from "../auth/dto";
import { taskSessionDto } from "./chatThreadDto";
import { chatScheduledTaskPolicy } from "../../../config/chat-scheduled-task-policy";

const id = z.string().uuid();
const title = z.string().trim().min(1).max(chatScheduledTaskPolicy.titleMaximumCharacters);
const prompt = z.string().trim().min(1).max(chatScheduledTaskPolicy.promptMaximumCharacters);
const zone = z.string().min(1).max(chatScheduledTaskPolicy.timeZoneMaximumCharacters);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const revision = z.number().int().positive().safe();
export const scheduledRuleDto = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("once"), local_date: date, local_time: localTime, time_zone: zone, selected_offset_minutes: z.number().int().min(-840).max(840).nullable() }),
  z.strictObject({ kind: z.literal("daily"), local_time: localTime, time_zone: zone }),
]);
export const scheduledTaskDto = z.strictObject({
  id, source_thread_id: z.string().min(1), title, prompt,
  rule: scheduledRuleDto, next_run_at: isoTimeDto.nullable(),
  status: z.enum(["active", "paused", "exhausted", "deleted"]),
  revision, created_at: isoTimeDto, updated_at: isoTimeDto,
});
export const scheduledTriggerDto = z.strictObject({
  id, task_id: id, kind: z.enum(["scheduled", "manual"]), scheduled_at: isoTimeDto.nullable(),
  definition_revision: revision, title, source_thread_id: z.string().min(1), time_zone: zone,
  status: z.enum(["claimed", "queued", "running", "succeeded", "failed", "state_unknown", "skipped"]),
  task_session_id: z.string().nullable(), target_thread_id: z.string().nullable(),
  input_message_id: z.string().nullable(), target_turn_id: z.string().nullable(), final_message_id: z.string().nullable(),
  error_code: z.string().nullable(), skipped_from_at: isoTimeDto.nullable(), skipped_through_at: isoTimeDto.nullable(),
  created_at: isoTimeDto, updated_at: isoTimeDto,
});
export const createScheduledTaskInputDto = z.strictObject({ source_thread_id: z.string().min(1), create_request_key: requestIdDto, title, prompt, rule: scheduledRuleDto });
export const scheduledTaskIdInputDto = z.strictObject({ task_id: id });
export const scheduledTaskRevisionInputDto = scheduledTaskIdInputDto.extend({ expected_revision: revision });
export const editScheduledTaskInputDto = scheduledTaskRevisionInputDto.extend({ title, prompt, rule: scheduledRuleDto });
export const runScheduledTaskInputDto = scheduledTaskIdInputDto.extend({ manual_request_key: requestIdDto });
export const dayScheduledTaskInputDto = z.strictObject({ local_date: date, display_time_zone: zone });
export const historyScheduledTaskInputDto = scheduledTaskIdInputDto.extend({ limit: z.number().int().min(1).max(chatScheduledTaskPolicy.historyPageMaximum), before_created_at: isoTimeDto.nullable() });
export const scheduledTaskResultDto = z.strictObject({ task: scheduledTaskDto });
export const scheduledTaskNullableResultDto = z.strictObject({ task: scheduledTaskDto.nullable() });
export const scheduledTriggerResultDto = z.strictObject({ trigger: scheduledTriggerDto });
export const scheduledTaskDayResultDto = z.strictObject({ tasks: z.array(scheduledTaskDto), triggers: z.array(scheduledTriggerDto) });
export const scheduledTaskHistoryResultDto = z.strictObject({ triggers: z.array(scheduledTriggerDto) });
export const claimScheduledTriggerInputDto = z.strictObject({});
export const claimScheduledTriggerResultDto = z.strictObject({ trigger: scheduledTriggerDto.nullable(), claim_id: id.nullable() });
export const prepareScheduledTriggerInputDto = z.strictObject({ trigger_id: id, claim_id: id });
export const prepareScheduledTriggerResultDto = z.discriminatedUnion("prepared", [
  z.strictObject({ prepared: z.literal(true), trigger: scheduledTriggerDto, task_session: taskSessionDto, authority_token: z.string().startsWith("sta_"), authority_expires_at: isoTimeDto }),
  z.strictObject({ prepared: z.literal(false), trigger: scheduledTriggerDto, error_code: z.string() }),
]);
export const renewScheduledTriggerInputDto = prepareScheduledTriggerInputDto;
export const renewScheduledTriggerResultDto = z.strictObject({ trigger: scheduledTriggerDto, authority_token: z.string().startsWith("sta_"), authority_expires_at: isoTimeDto });
export const startScheduledTriggerInputDto = prepareScheduledTriggerInputDto.extend({ target_turn_id: z.string().min(1).max(160) });
export const startScheduledTriggerResultDto = z.strictObject({ trigger: scheduledTriggerDto });
export const finishScheduledTriggerInputDto = prepareScheduledTriggerInputDto.extend({
  status: z.enum(["succeeded", "failed", "state_unknown"]),
  final_message_id: z.string().nullable(), error_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/).nullable(),
});
export const finishScheduledTriggerResultDto = z.strictObject({ trigger: scheduledTriggerDto });
export const reconcileScheduledTriggerInputDto = z.strictObject({ trigger_id: id });
export const reconcileScheduledTriggerResultDto = z.strictObject({ trigger: scheduledTriggerDto });
export const resolveScheduledAuthorityInputDto = z.strictObject({});
export const resolveScheduledAuthorityResultDto = z.strictObject({
  trigger_id: id, claim_id: id, service_client_id: z.string().min(1), client_id: z.string().min(1),
  subject: z.string().min(1), canonical_user_id: z.string().regex(/^[1-9]\d*$/),
  source_thread_id: z.string().min(1), target_thread_id: z.string().min(1),
  scopes: z.array(z.enum(["dream:read", "dream:write"])), purpose: z.literal("scheduled-chat-persistence"),
  issued_at: isoTimeDto, expires_at: isoTimeDto,
});
export const chatScheduledTaskOperationContracts = {
  "scheduled-task.create": { audience: "user", kind: "write", userScope: "dream:write", input: createScheduledTaskInputDto, output: scheduledTaskResultDto },
  "scheduled-task.get": { audience: "user", kind: "read", userScope: "dream:read", input: scheduledTaskIdInputDto, output: scheduledTaskNullableResultDto },
  "scheduled-task.day": { audience: "user", kind: "read", userScope: "dream:read", input: dayScheduledTaskInputDto, output: scheduledTaskDayResultDto },
  "scheduled-task.history": { audience: "user", kind: "read", userScope: "dream:read", input: historyScheduledTaskInputDto, output: scheduledTaskHistoryResultDto },
  "scheduled-task.edit": { audience: "user", kind: "write", userScope: "dream:write", input: editScheduledTaskInputDto, output: scheduledTaskResultDto },
  "scheduled-task.pause": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskResultDto },
  "scheduled-task.resume": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskResultDto },
  "scheduled-task.delete": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskResultDto },
  "scheduled-task.restore": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskResultDto },
  "scheduled-task.run": { audience: "user", kind: "write", userScope: "dream:write", input: runScheduledTaskInputDto, output: scheduledTriggerResultDto },
  "scheduled-trigger.claim": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: claimScheduledTriggerInputDto, output: claimScheduledTriggerResultDto },
  "scheduled-trigger.prepare": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: prepareScheduledTriggerInputDto, output: prepareScheduledTriggerResultDto },
  "scheduled-trigger.renew": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: renewScheduledTriggerInputDto, output: renewScheduledTriggerResultDto },
  "scheduled-trigger.start": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: startScheduledTriggerInputDto, output: startScheduledTriggerResultDto },
  "scheduled-trigger.finish": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: finishScheduledTriggerInputDto, output: finishScheduledTriggerResultDto },
  "scheduled-trigger.reconcile": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: reconcileScheduledTriggerInputDto, output: reconcileScheduledTriggerResultDto },
  "scheduled-trigger.authority.resolve": { audience: "background", kind: "read", backgroundScope: "schedule:execute", input: resolveScheduledAuthorityInputDto, output: resolveScheduledAuthorityResultDto },
} as const;
export type ChatScheduledTaskOperation = keyof typeof chatScheduledTaskOperationContracts;
export type ChatScheduledUserOperation = { [K in ChatScheduledTaskOperation]: typeof chatScheduledTaskOperationContracts[K]["audience"] extends "user" ? K : never }[ChatScheduledTaskOperation];
export type ChatScheduledBackgroundOperation = Exclude<ChatScheduledTaskOperation, ChatScheduledUserOperation>;
