// [Input] Explicit once/daily settings, v2 interval/Editor targets, and v3 structured recurrence/Thread/model options.
// [Output] Immutable v1/v2 contracts and closed v3 owner-scoped schedule, history, dispatch, and resume contracts.
// [Pos] Named Admin scheduled Chat operation contract; no actor, SQL, path or credential selectors.
// [Sync] 2026-10-07: add a strict read projection for source and execution Thread scheduled activity.
// [Sync] 2026-10-07: append v3 hourly/weekly, Thread-mode and model-snapshot contracts without changing v1/v2 hashes.
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

export const scheduledRuleV2Dto = z.discriminatedUnion("kind", [
  ...scheduledRuleDto.options,
  z.strictObject({
    kind: z.literal("interval"),
    interval_minutes: z.number().int().min(1).max(chatScheduledTaskPolicy.intervalMaximumMinutes),
    time_zone: zone,
  }),
]);
export const scheduledTaskV2Dto = scheduledTaskDto.omit({ rule: true }).extend({ rule: scheduledRuleV2Dto });
export const scheduledTriggerV2Dto = scheduledTriggerDto;
export const createScheduledTaskV2InputDto = createScheduledTaskInputDto.omit({ rule: true }).extend({
  rule: scheduledRuleV2Dto,
  target_editor_session_id: z.string().min(1).nullable(),
});
export const editScheduledTaskV2InputDto = editScheduledTaskInputDto.omit({ rule: true }).extend({ rule: scheduledRuleV2Dto });
export const scheduledTaskV2ResultDto = z.strictObject({ task: scheduledTaskV2Dto });
export const scheduledTaskV2NullableResultDto = z.strictObject({ task: scheduledTaskV2Dto.nullable() });
export const scheduledTriggerV2ResultDto = z.strictObject({ trigger: scheduledTriggerV2Dto });
export const scheduledTaskDayV2ResultDto = z.strictObject({ tasks: z.array(scheduledTaskV2Dto), triggers: z.array(scheduledTriggerV2Dto) });
export const scheduledTaskHistoryV2ResultDto = z.strictObject({ triggers: z.array(scheduledTriggerV2Dto) });
export const scheduledTaskThreadInputDto = z.strictObject({ thread_id: z.string().min(1) });
export const scheduledTaskThreadResultDto = z.strictObject({
  created: z.array(scheduledTaskV2Dto),
  source: z.strictObject({ task: scheduledTaskV2Dto, trigger: scheduledTriggerDto }).nullable(),
});
export const claimScheduledTriggerV2ResultDto = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("idle") }),
  z.strictObject({ action: z.literal("dispatch"), trigger: scheduledTriggerV2Dto, claim_id: id }),
  z.strictObject({ action: z.literal("reconcile"), trigger_id: id }),
]);
export const prepareScheduledTriggerV2ResultDto = z.discriminatedUnion("prepared", [
  z.strictObject({ prepared: z.literal(true), trigger: scheduledTriggerV2Dto, task_session: taskSessionDto,
    authority_token: z.string().startsWith("sta_"), authority_expires_at: isoTimeDto,
    target_editor_session_id: z.string().min(1).nullable() }),
  z.strictObject({ prepared: z.literal(false), trigger: scheduledTriggerV2Dto, error_code: z.string() }),
]);
export const resolveScheduledAuthorityV2ResultDto = resolveScheduledAuthorityResultDto.extend({
  target_editor_session_id: z.string().min(1).nullable(),
});

export const chatScheduledTaskV2OperationContracts = {
  "scheduled-task.v2.create": { audience: "user", kind: "write", userScope: "dream:write", input: createScheduledTaskV2InputDto, output: scheduledTaskV2ResultDto },
  "scheduled-task.v2.get": { audience: "user", kind: "read", userScope: "dream:read", input: scheduledTaskIdInputDto, output: scheduledTaskV2NullableResultDto },
  "scheduled-task.v2.day": { audience: "user", kind: "read", userScope: "dream:read", input: dayScheduledTaskInputDto, output: scheduledTaskDayV2ResultDto },
  "scheduled-task.v2.history": { audience: "user", kind: "read", userScope: "dream:read", input: historyScheduledTaskInputDto, output: scheduledTaskHistoryV2ResultDto },
  "scheduled-task.v2.edit": { audience: "user", kind: "write", userScope: "dream:write", input: editScheduledTaskV2InputDto, output: scheduledTaskV2ResultDto },
  "scheduled-task.v2.pause": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskV2ResultDto },
  "scheduled-task.v2.resume": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskV2ResultDto },
  "scheduled-task.v2.delete": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskV2ResultDto },
  "scheduled-task.v2.restore": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskV2ResultDto },
  "scheduled-task.v2.run": { audience: "user", kind: "write", userScope: "dream:write", input: runScheduledTaskInputDto, output: scheduledTriggerV2ResultDto },
  "scheduled-trigger.v2.claim": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: claimScheduledTriggerInputDto, output: claimScheduledTriggerV2ResultDto },
  "scheduled-trigger.v2.prepare": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: prepareScheduledTriggerInputDto, output: prepareScheduledTriggerV2ResultDto },
  "scheduled-trigger.v2.renew": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: renewScheduledTriggerInputDto, output: renewScheduledTriggerResultDto },
  "scheduled-trigger.v2.start": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: startScheduledTriggerInputDto, output: startScheduledTriggerResultDto },
  "scheduled-trigger.v2.finish": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: finishScheduledTriggerInputDto, output: finishScheduledTriggerResultDto },
  "scheduled-trigger.v2.reconcile": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: reconcileScheduledTriggerInputDto, output: reconcileScheduledTriggerResultDto },
  "scheduled-trigger.v2.authority.resolve": { audience: "background", kind: "read", backgroundScope: "schedule:execute", input: resolveScheduledAuthorityInputDto, output: resolveScheduledAuthorityV2ResultDto },
  "scheduled-task.v2.thread": { audience: "user", kind: "read", userScope: "dream:read", input: scheduledTaskThreadInputDto, output: scheduledTaskThreadResultDto },
} as const;
export type ChatScheduledTaskV2Operation = keyof typeof chatScheduledTaskV2OperationContracts;
export type ChatScheduledUserV2Operation = { [K in ChatScheduledTaskV2Operation]: typeof chatScheduledTaskV2OperationContracts[K]["audience"] extends "user" ? K : never }[ChatScheduledTaskV2Operation];
export type ChatScheduledBackgroundV2Operation = Exclude<ChatScheduledTaskV2Operation, ChatScheduledUserV2Operation>;

export const scheduledWeekdayDto = z.enum(["MO", "TU", "WE", "TH", "FR", "SA", "SU"]);
export const runThreadModeDto = z.enum(["source_thread", "new_thread_each_run"]);
export const scheduledModelAliasDto = z.string().trim().min(1).max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/);
export const scheduledRuleV3Dto = z.discriminatedUnion("kind", [
  ...scheduledRuleV2Dto.options,
  z.strictObject({
    kind: z.literal("hourly"),
    interval_hours: z.number().int().min(1).max(Math.floor(chatScheduledTaskPolicy.intervalMaximumMinutes / 60)),
    minute: z.number().int().min(0).max(59),
    time_zone: zone,
  }),
  z.strictObject({
    kind: z.literal("weekly"),
    weekdays: z.array(scheduledWeekdayDto).min(1).max(7)
      .refine(value => new Set(value).size === value.length, "weekdays must be unique"),
    local_time: localTime,
    time_zone: zone,
  }),
]);
export const scheduledTaskV3Dto = scheduledTaskV2Dto.omit({ rule: true }).extend({
  rule: scheduledRuleV3Dto,
  run_thread_mode: runThreadModeDto,
  model_alias: scheduledModelAliasDto.nullable(),
});
export const scheduledTriggerV3Dto = scheduledTriggerDto.extend({
  run_thread_mode_snapshot: runThreadModeDto,
  model_alias_snapshot: scheduledModelAliasDto.nullable(),
});
export const createScheduledTaskV3InputDto = createScheduledTaskV2InputDto.omit({ rule: true }).extend({
  rule: scheduledRuleV3Dto,
  run_thread_mode: runThreadModeDto,
  model_alias: scheduledModelAliasDto,
});
export const editScheduledTaskV3InputDto = editScheduledTaskV2InputDto.omit({ rule: true }).extend({
  rule: scheduledRuleV3Dto,
  run_thread_mode: runThreadModeDto,
  model_alias: scheduledModelAliasDto,
});
export const scheduledTaskV3ResultDto = z.strictObject({ task: scheduledTaskV3Dto });
export const scheduledTaskV3NullableResultDto = z.strictObject({ task: scheduledTaskV3Dto.nullable() });
export const scheduledTriggerV3ResultDto = z.strictObject({ trigger: scheduledTriggerV3Dto });
export const scheduledTaskDayV3ResultDto = z.strictObject({ tasks: z.array(scheduledTaskV3Dto), triggers: z.array(scheduledTriggerV3Dto) });
export const scheduledTaskHistoryV3ResultDto = z.strictObject({ triggers: z.array(scheduledTriggerV3Dto) });
export const scheduledTaskThreadV3ResultDto = z.strictObject({
  created: z.array(scheduledTaskV3Dto),
  source: z.strictObject({ task: scheduledTaskV3Dto, trigger: scheduledTriggerV3Dto }).nullable(),
});
export const claimScheduledTriggerV3ResultDto = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("idle") }),
  z.strictObject({ action: z.literal("dispatch"), trigger: scheduledTriggerV3Dto, claim_id: id }),
  z.strictObject({ action: z.literal("reconcile"), trigger_id: id }),
]);
export const prepareScheduledTriggerV3ResultDto = z.discriminatedUnion("prepared", [
  z.strictObject({
    prepared: z.literal(true), trigger: scheduledTriggerV3Dto, task_session: taskSessionDto.nullable(),
    target_thread_id: z.string().min(1), input_message_id: z.string().min(1), resume_existing_thread: z.boolean(),
    model_alias: scheduledModelAliasDto.nullable(), authority_token: z.string().startsWith("sta_"),
    authority_expires_at: isoTimeDto, target_editor_session_id: z.string().min(1).nullable(),
  }),
  z.strictObject({ prepared: z.literal(false), trigger: scheduledTriggerV3Dto, error_code: z.string() }),
]);
export const resolveScheduledAuthorityV3ResultDto = resolveScheduledAuthorityV2ResultDto;

export const chatScheduledTaskV3OperationContracts = {
  "scheduled-task.v3.create": { audience: "user", kind: "write", userScope: "dream:write", input: createScheduledTaskV3InputDto, output: scheduledTaskV3ResultDto },
  "scheduled-task.v3.get": { audience: "user", kind: "read", userScope: "dream:read", input: scheduledTaskIdInputDto, output: scheduledTaskV3NullableResultDto },
  "scheduled-task.v3.day": { audience: "user", kind: "read", userScope: "dream:read", input: dayScheduledTaskInputDto, output: scheduledTaskDayV3ResultDto },
  "scheduled-task.v3.history": { audience: "user", kind: "read", userScope: "dream:read", input: historyScheduledTaskInputDto, output: scheduledTaskHistoryV3ResultDto },
  "scheduled-task.v3.edit": { audience: "user", kind: "write", userScope: "dream:write", input: editScheduledTaskV3InputDto, output: scheduledTaskV3ResultDto },
  "scheduled-task.v3.pause": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskV3ResultDto },
  "scheduled-task.v3.resume": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskV3ResultDto },
  "scheduled-task.v3.delete": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskV3ResultDto },
  "scheduled-task.v3.restore": { audience: "user", kind: "write", userScope: "dream:write", input: scheduledTaskRevisionInputDto, output: scheduledTaskV3ResultDto },
  "scheduled-task.v3.run": { audience: "user", kind: "write", userScope: "dream:write", input: runScheduledTaskInputDto, output: scheduledTriggerV3ResultDto },
  "scheduled-trigger.v3.claim": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: claimScheduledTriggerInputDto, output: claimScheduledTriggerV3ResultDto },
  "scheduled-trigger.v3.prepare": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: prepareScheduledTriggerInputDto, output: prepareScheduledTriggerV3ResultDto },
  "scheduled-trigger.v3.renew": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: renewScheduledTriggerInputDto, output: renewScheduledTriggerResultDto.extend({ trigger: scheduledTriggerV3Dto }) },
  "scheduled-trigger.v3.start": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: startScheduledTriggerInputDto, output: startScheduledTriggerResultDto.extend({ trigger: scheduledTriggerV3Dto }) },
  "scheduled-trigger.v3.finish": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: finishScheduledTriggerInputDto, output: finishScheduledTriggerResultDto.extend({ trigger: scheduledTriggerV3Dto }) },
  "scheduled-trigger.v3.reconcile": { audience: "background", kind: "write", backgroundScope: "schedule:execute", input: reconcileScheduledTriggerInputDto, output: reconcileScheduledTriggerResultDto.extend({ trigger: scheduledTriggerV3Dto }) },
  "scheduled-trigger.v3.authority.resolve": { audience: "background", kind: "read", backgroundScope: "schedule:execute", input: resolveScheduledAuthorityInputDto, output: resolveScheduledAuthorityV3ResultDto },
  "scheduled-task.v3.thread": { audience: "user", kind: "read", userScope: "dream:read", input: scheduledTaskThreadInputDto, output: scheduledTaskThreadV3ResultDto },
} as const;
export type ChatScheduledTaskV3Operation = keyof typeof chatScheduledTaskV3OperationContracts;
export type ChatScheduledUserV3Operation = { [K in ChatScheduledTaskV3Operation]: typeof chatScheduledTaskV3OperationContracts[K]["audience"] extends "user" ? K : never }[ChatScheduledTaskV3Operation];
export type ChatScheduledBackgroundV3Operation = Exclude<ChatScheduledTaskV3Operation, ChatScheduledUserV3Operation>;
