// [Input] Reflections task commands, task-bound worker facts and legacy report history requests.
// [Output] Sixteen closed operation DTOs without actor, SQL, path or arbitrary Thread selectors.
// [Pos] Registered Reflections aggregate contract; Dream retains Agent, scheduler, EventBus, SSE and files.
// [Sync] 2026-09-15: expose the persisted event high-water mark when a worker restores a task.
import { z } from "zod";
import { isoTimeDto } from "../auth/dto";
import { chatMessageDto } from "./chatThreadDto";
import { reflectionsSectionPolicy } from "../../../config/reflections-section-policy";
import { reflectionTaskPolicy } from "../../../config/reflection-task-policy";

const identifier = z.string().min(1).max(256);
export const postgresInt4Max = 2_147_483_647;
export const reflectionEventSequenceDto = z.number().int().min(1).max(postgresInt4Max);
export const reflectionEventHighWaterDto = z.number().int().min(0).max(postgresInt4Max);
export const reflectionTaskIdDto = z.uuid();
export const reflectionSectionDto = z.enum(reflectionsSectionPolicy.sections);
export const reflectionTaskStatusDto = z.enum(["CREATED", "ASSEMBLING", "QUEUED", "RUNNING", "COMPLETED", "PARTIAL_FAILED", "FAILED"]);
export const reflectionSectionStatusDto = z.enum(["PENDING", "RUNNING", "COMPLETED", "FAILED"]);
export const reflectionTerminalStatusDto = z.enum(["COMPLETED", "PARTIAL_FAILED", "FAILED"]);
export const reflectionConfidenceDto = z.enum(["high", "medium", "low"]);
const uniqueStrings = z.array(identifier).refine(values => new Set(values).size === values.length);
const uniqueSections = z.array(reflectionSectionDto).min(1).max(reflectionsSectionPolicy.sections.length).refine(values => new Set(values).size === values.length);

const reflectionTaskInputFields = {
  session_ids: uniqueStrings,
  start_date: z.iso.date().nullable(),
  end_date: z.iso.date().nullable(),
  language: z.enum(["en", "zh"]),
  language_label: z.enum(["English", "Simplified Chinese"]),
};
const validTaskInput = (value: { language: "en" | "zh"; language_label: "English" | "Simplified Chinese"; start_date?: string | null; end_date?: string | null }) => (value.language === "zh" ? value.language_label === "Simplified Chinese" : value.language_label === "English") && (value.start_date == null || value.end_date == null || value.start_date <= value.end_date);
export const reflectionTaskCreateSnapshotDto = z.strictObject(reflectionTaskInputFields).refine(validTaskInput);
export const reflectionTaskPublicInputDto = z.strictObject({ ...reflectionTaskInputFields, session_count: z.number().int().nonnegative().safe().optional() }).refine(validTaskInput);

export const reflectionResultDto = z.strictObject({
  id: reflectionTaskIdDto, task_id: reflectionTaskIdDto, section: reflectionSectionDto,
  title: z.string().max(reflectionTaskPolicy.resultTitleMaxCharacters), description: z.string().max(reflectionTaskPolicy.resultDescriptionMaxCharacters), related_session_ids: uniqueStrings,
  evidence: z.string().max(reflectionTaskPolicy.resultEvidenceMaxCharacters), confidence: reflectionConfidenceDto, created_at: isoTimeDto.nullable(),
});
export const reflectionSectionStateDto = z.strictObject({
  section: reflectionSectionDto, status: reflectionSectionStatusDto, result_count: z.number().int().nonnegative().safe(),
  revision: z.number().int().positive().safe(), started_at: isoTimeDto.nullable(), completed_at: isoTimeDto.nullable(),
  error_summary: z.string().nullable(),
});
export const reflectionTaskDto = z.strictObject({
  id: reflectionTaskIdDto, task_id: reflectionTaskIdDto, status: reflectionTaskStatusDto, sections: uniqueSections,
  input_snapshot: reflectionTaskPublicInputDto, workspace_path: z.string().nullable(), agent_contract_version: identifier.nullable(),
  error_summary: z.string().nullable(), revision: z.number().int().positive().safe(),
  created_at: isoTimeDto.nullable(), started_at: isoTimeDto.nullable(), completed_at: isoTimeDto.nullable(), updated_at: isoTimeDto.nullable(),
  section_states: z.array(reflectionSectionStateDto),
}).superRefine((value, ctx) => {
  if (value.id !== value.task_id) ctx.addIssue({ code: "custom", message: "Task aliases must match." });
  const actual = value.section_states.map(item => item.section);
  if (actual.length && (actual.length !== value.sections.length || actual.some((section, index) => section !== value.sections[index]))) ctx.addIssue({ code: "custom", message: "Section state order must match the task." });
  if (reflectionTerminalStatusDto.safeParse(value.status).success !== (value.completed_at !== null)) ctx.addIssue({ code: "custom", message: "Task completion time must match terminal status." });
});

export const reflectionTaskLookupDto = z.strictObject({ task_id: reflectionTaskIdDto });
export const reflectionTaskCreateInputDto = z.strictObject({
  sections: uniqueSections,
  input_snapshot: reflectionTaskCreateSnapshotDto,
});
export const reflectionTaskGetOutputDto = z.strictObject({ task: reflectionTaskDto, results: z.array(reflectionResultDto) });
export const reflectionTaskLatestOutputDto = z.strictObject({ task: reflectionTaskDto.nullable(), results: z.array(reflectionResultDto) });
export const reflectionTaskStartOutputDto = z.strictObject({ task: reflectionTaskDto, terminal: z.boolean(), report_missing: z.boolean() });

export const reflectionSessionSnapshotDto = z.strictObject({
  id: identifier, name: z.string().nullable(), created_at: isoTimeDto.nullable(), updated_at: isoTimeDto.nullable(),
  labels: z.array(z.string()), first_line: z.string(), text: z.string(),
});
export const reflectionPromptSnapshotDto = z.strictObject({ section: reflectionSectionDto, prompt_files_json: z.string().nullable() });
export const reflectionLaunchSnapshotDto = z.strictObject({
  schema_version: z.literal(1), task_id: reflectionTaskIdDto, language: z.enum(["en", "zh"]),
  sessions: z.array(reflectionSessionSnapshotDto), custom_prompts: z.array(reflectionPromptSnapshotDto),
  stats: z.strictObject({ days: z.number().int().nonnegative().safe(), entries: z.number().int().nonnegative().safe(), words: z.number().int().nonnegative().safe() }),
});
export const reflectionWorkerLoadOutputDto = z.strictObject({ task: reflectionTaskDto, launch_snapshot: reflectionLaunchSnapshotDto, last_event_sequence: reflectionEventHighWaterDto });

export const reflectionTaskAdvanceInputDto = z.discriminatedUnion("action", [
  reflectionTaskLookupDto.extend({ action: z.literal("context-ready"), expected_revision: z.number().int().positive().safe() }),
  reflectionTaskLookupDto.extend({ action: z.literal("run-started"), expected_revision: z.number().int().positive().safe() }),
  reflectionTaskLookupDto.extend({ action: z.literal("finalize"), expected_revision: z.number().int().positive().safe(), error_summary: z.string().max(reflectionTaskPolicy.errorSummaryMaxCharacters).nullable() }),
  reflectionTaskLookupDto.extend({ action: z.literal("fatal-fail"), expected_revision: z.number().int().positive().safe(), error_summary: z.string().min(1).max(reflectionTaskPolicy.errorSummaryMaxCharacters) }),
]);
export const reflectionTaskAdvanceOutputDto = z.strictObject({ status: reflectionTaskStatusDto, revision: z.number().int().positive().safe() });
export const reflectionSectionBeginInputDto = reflectionTaskLookupDto.extend({ section: reflectionSectionDto, expected_revision: z.number().int().positive().safe() });
export const reflectionAuthorityTokenDto = z.string().regex(/^rta_[A-Za-z0-9_-]{43}$/);
export const reflectionAuthorityDto = z.strictObject({
  token: reflectionAuthorityTokenDto, purpose: z.literal("reflections-worker"), task_id: reflectionTaskIdDto, section: reflectionSectionDto,
  thread_id: reflectionTaskIdDto, scopes: z.tuple([z.literal("dream:read"), z.literal("dream:write")]),
  expires_at: isoTimeDto, maximum_expires_at: isoTimeDto,
});
export const reflectionSectionBeginOutputDto = z.strictObject({ section: reflectionSectionDto, thread_id: reflectionTaskIdDto, status: z.literal("RUNNING"), revision: z.number().int().positive().safe(), authority: reflectionAuthorityDto });
export const reflectionSectionAuthorityInputDto = reflectionTaskLookupDto.extend({ section: reflectionSectionDto });
export const reflectionSectionAuthorityRenewOutputDto = reflectionAuthorityDto.omit({ token: true });
export const reflectionSectionAuthorityRevokeOutputDto = z.strictObject({ revoked: z.literal(true) });
export const reflectionSectionTranscriptInputDto = reflectionTaskLookupDto.extend({ section: reflectionSectionDto });
export const reflectionSectionTranscriptOutputDto = z.strictObject({ section: reflectionSectionDto, messages: z.array(chatMessageDto) });
export const reflectionInsightInputDto = z.strictObject({
  title: z.string().max(reflectionTaskPolicy.resultTitleMaxCharacters), description: z.string().max(reflectionTaskPolicy.resultDescriptionMaxCharacters), related_session_ids: uniqueStrings,
  evidence: z.string().max(reflectionTaskPolicy.resultEvidenceMaxCharacters), confidence: reflectionConfidenceDto,
});
export const reflectionSectionFinishInputDto = z.discriminatedUnion("outcome", [
  reflectionTaskLookupDto.extend({ section: reflectionSectionDto, expected_revision: z.number().int().positive().safe(), outcome: z.literal("completed"), results: z.array(reflectionInsightInputDto) }),
  reflectionTaskLookupDto.extend({ section: reflectionSectionDto, expected_revision: z.number().int().positive().safe(), outcome: z.literal("failed"), error_summary: z.string().min(1).max(reflectionTaskPolicy.errorSummaryMaxCharacters) }),
]);
export const reflectionSectionFinishOutputDto = z.strictObject({ section: reflectionSectionDto, status: z.enum(["COMPLETED", "FAILED"]), result_count: z.number().int().nonnegative().safe(), revision: z.number().int().positive().safe() });

export const reflectionEventTypeDto = z.enum([
  "reflection.task.created", "reflection.context.ready", "reflection.task.started", "reflection.section.started",
  "reflection.section.completed", "reflection.section.failed", "reflection.task.completed", "reflection.task.partial_failed", "reflection.task.failed",
]);
const eventPayloadDto = z.record(z.string(), z.json());
const reflectionEventFields = {
  event_id: identifier, sequence: reflectionEventSequenceDto, event_type: reflectionEventTypeDto,
  created_at: isoTimeDto, payload: eventPayloadDto,
};
export const reflectionEventAppendInputDto = reflectionTaskLookupDto.extend(reflectionEventFields).superRefine((value, ctx) => {
  const expected = `evt_${value.task_id.replaceAll("-", "")}_${String(value.sequence).padStart(6, "0")}`;
  if (value.event_id !== expected) ctx.addIssue({ code: "custom", path: ["event_id"], message: "Event identity must bind task and sequence." });
});
export const reflectionEventDto = reflectionTaskLookupDto.extend({ sequence: reflectionEventFields.sequence, created_at: reflectionEventFields.created_at, payload: reflectionEventFields.payload, id: identifier, type: reflectionEventTypeDto });
export const reflectionEventListInputDto = reflectionTaskLookupDto.extend({ after_event_id: identifier.nullable() });
export const reflectionEventListOutputDto = z.strictObject({ events: z.array(reflectionEventDto) });
export const reflectionEventAppendOutputDto = z.strictObject({ event_id: identifier, accepted: z.literal(true) });

export const reflectionReportEnsureOutputDto = z.strictObject({ report_id: z.string().nullable(), report_type: z.string().nullable(), created: z.boolean() });
export const analysisReportListInputDto = z.strictObject({ limit: z.number().int().positive().safe().default(10) });
const reportDataJsonDto = z.string().refine(value => { try { const parsed: unknown = JSON.parse(value); return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0; } catch { return false; } });
export const analysisReportDto = z.strictObject({ id: z.string().regex(/^[1-9][0-9]*$/), report_type: identifier, report_data_json: reportDataJsonDto, created_at: isoTimeDto.nullable() });
export const analysisReportListOutputDto = z.strictObject({ reports: z.array(analysisReportDto) });
export const analysisReportSaveInputDto = z.strictObject({ report_type: identifier, report_data_json: reportDataJsonDto, all_notes_text: z.string().default("") });
export const analysisReportSaveOutputDto = z.strictObject({ success: z.literal(true) });

export const reflectionTaskOperationContracts = {
  "reflection-task.create": { audience: "oauth", kind: "write", userScope: "dream:write", input: reflectionTaskCreateInputDto, output: reflectionTaskGetOutputDto },
  "reflection-task.start": { audience: "oauth", kind: "write", userScope: "dream:write", input: reflectionTaskLookupDto, output: reflectionTaskStartOutputDto },
  "reflection-task.get": { audience: "oauth", kind: "read", userScope: "dream:read", input: reflectionTaskLookupDto, output: reflectionTaskGetOutputDto },
  "reflection-task.latest": { audience: "oauth", kind: "read", userScope: "dream:read", input: z.strictObject({}), output: reflectionTaskLatestOutputDto },
  "reflection-task.events": { audience: "oauth", kind: "read", userScope: "dream:read", input: reflectionEventListInputDto, output: reflectionEventListOutputDto },
  "analysis-report.list": { audience: "oauth", kind: "read", userScope: "dream:read", input: analysisReportListInputDto, output: analysisReportListOutputDto },
  "analysis-report.save": { audience: "oauth", kind: "write", userScope: "dream:write", input: analysisReportSaveInputDto, output: analysisReportSaveOutputDto },
  "reflection-task.worker-load": { audience: "background", kind: "write", backgroundScope: "reflections:execute", input: reflectionTaskLookupDto, output: reflectionWorkerLoadOutputDto },
  "reflection-task.advance": { audience: "background", kind: "write", backgroundScope: "reflections:execute", input: reflectionTaskAdvanceInputDto, output: reflectionTaskAdvanceOutputDto },
  "reflection-section.begin": { audience: "background", kind: "write", backgroundScope: "reflections:execute", input: reflectionSectionBeginInputDto, output: reflectionSectionBeginOutputDto },
  "reflection-section.authority-renew": { audience: "background", kind: "write", backgroundScope: "reflections:execute", input: reflectionSectionAuthorityInputDto, output: reflectionSectionAuthorityRenewOutputDto },
  "reflection-section.authority-revoke": { audience: "background", kind: "write", backgroundScope: "reflections:execute", input: reflectionSectionAuthorityInputDto, output: reflectionSectionAuthorityRevokeOutputDto },
  "reflection-section.transcript": { audience: "background", kind: "read", backgroundScope: "reflections:execute", input: reflectionSectionTranscriptInputDto, output: reflectionSectionTranscriptOutputDto },
  "reflection-section.finish": { audience: "background", kind: "write", backgroundScope: "reflections:execute", input: reflectionSectionFinishInputDto, output: reflectionSectionFinishOutputDto },
  "reflection-event.append": { audience: "background", kind: "write", backgroundScope: "reflections:execute", input: reflectionEventAppendInputDto, output: reflectionEventAppendOutputDto },
  "reflection-report.ensure": { audience: "background", kind: "write", backgroundScope: "reflections:execute", input: reflectionTaskLookupDto, output: reflectionReportEnsureOutputDto },
} as const;
export type ReflectionTaskOperation = keyof typeof reflectionTaskOperationContracts;
export type ReflectionTaskUserOperation = { [K in ReflectionTaskOperation]: typeof reflectionTaskOperationContracts[K]["audience"] extends "oauth" ? K : never }[ReflectionTaskOperation];
export type ReflectionTaskBackgroundOperation = Exclude<ReflectionTaskOperation, ReflectionTaskUserOperation>;
export type ReflectionTaskPublicInput = z.infer<typeof reflectionTaskPublicInputDto>;
export type ReflectionLaunchSnapshot = z.infer<typeof reflectionLaunchSnapshotDto>;
