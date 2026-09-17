// [Input] Registered Reflections operation catalog and adversarial task/event payloads.
// [Output] Closed sixteen-operation, task-bound event and private-snapshot contract evidence.
// [Pos] Provider-free DTO gate; no Route, Registry, PostgreSQL, Agent, network or filesystem.
// [Sync] 2026-09-15: bind event sequence wire schemas to the PostgreSQL int4 column range.
import { expect, it } from "vitest";
import { z } from "zod";
import { reflectionReportListCapacity } from "../../../config/reflection-task-policy";
import * as dto from "./reflectionTaskDto";

const taskId = "11111111-1111-4111-8111-111111111111";
it("defines the reviewed sixteen operations and separates OAuth from background authority", () => {
  expect(Object.keys(dto.reflectionTaskOperationContracts)).toEqual([
    "reflection-task.create", "reflection-task.start", "reflection-task.get", "reflection-task.latest", "reflection-task.events", "analysis-report.list", "analysis-report.save",
    "reflection-task.worker-load", "reflection-task.advance", "reflection-section.begin", "reflection-section.authority-renew", "reflection-section.authority-revoke", "reflection-section.transcript", "reflection-section.finish", "reflection-event.append", "reflection-report.ensure",
  ]);
  expect(Object.values(dto.reflectionTaskOperationContracts).filter(item => item.audience === "oauth")).toHaveLength(7);
  expect(Object.values(dto.reflectionTaskOperationContracts).filter(item => item.audience === "background")).toHaveLength(9);
  expect(Object.values(dto.reflectionTaskOperationContracts).filter(item => item.audience === "background").every(item => item.backgroundScope === "reflections:execute")).toBe(true);
});

it("keeps the original report shape while request bytes and list capacity remain server policy", () => {
  expect(dto.analysisReportListInputDto.parse({})).toEqual({ limit: 10 });
  expect(dto.analysisReportListInputDto.safeParse({ limit: Number.MAX_SAFE_INTEGER }).success).toBe(true);
  expect(reflectionReportListCapacity({ DREAM_REFLECTION_REPORT_LIST_MAX_ROWS: "100" })).toBe(100);
  expect(() => reflectionReportListCapacity({})).toThrowError("REFLECTION_REPORT_POLICY_INVALID");
  const base = { report_type: "full_analysis", report_data_json: '{"echoes":[],"integer":9007199254740993,"float":1.0}' };
  expect(dto.analysisReportSaveInputDto.parse(base)).toEqual({ ...base, all_notes_text: "" });
  expect(dto.analysisReportSaveInputDto.safeParse({ ...base, report_data_json: "[]" }).success).toBe(false);
  expect(dto.analysisReportSaveInputDto.safeParse({ ...base, all_notes_text: "x".repeat(1_000_001) }).success).toBe(true);
});

it("accepts only current public launch choices and keeps private Session text outside them", () => {
  const input = { sections: ["echoes", "traits"], input_snapshot: { session_ids: ["session-1"], start_date: "2026-09-01", end_date: "2026-09-15", language: "zh", language_label: "Simplified Chinese" } };
  expect(dto.reflectionTaskCreateInputDto.parse(input)).toEqual(input);
  for (const key of ["user_id", "actor_id", "service_client_id", "workspace_path", "thread_id", "launch_snapshot_json", "sql", "table"])
    expect(dto.reflectionTaskCreateInputDto.safeParse({ ...input, [key]: "forbidden" }).success, key).toBe(false);
  expect(dto.reflectionTaskCreateInputDto.safeParse({ ...input, input_snapshot: { ...input.input_snapshot, text: "private body" } }).success).toBe(false);
  expect(dto.reflectionTaskCreateInputDto.safeParse({ ...input, sections: ["echoes", "echoes"] }).success).toBe(false);
});

it("binds every new event id to task and positive sequence", () => {
  const base = { task_id: taskId, sequence: 7, event_type: "reflection.section.completed", created_at: "2026-09-15T00:00:00Z", payload: { section: "echoes", result_count: 2 } };
  const eventId = `evt_${taskId.replaceAll("-", "")}_000007`;
  expect(dto.reflectionEventAppendInputDto.parse({ ...base, event_id: eventId })).toMatchObject({ event_id: eventId, sequence: 7 });
  expect(dto.reflectionEventAppendInputDto.safeParse({ ...base, event_id: "evt_000007" }).success).toBe(false);
  expect(dto.reflectionEventAppendInputDto.safeParse({ ...base, event_id: eventId, sequence: 0 }).success).toBe(false);
  const maximum = dto.postgresInt4Max, maximumId = `evt_${taskId.replaceAll("-", "")}_${maximum}`;
  expect(dto.reflectionEventAppendInputDto.safeParse({ ...base, event_id: maximumId, sequence: maximum }).success).toBe(true);
  expect(dto.reflectionEventAppendInputDto.safeParse({ ...base, event_id: `evt_${taskId.replaceAll("-", "")}_${maximum + 1}`, sequence: maximum + 1 }).success).toBe(false);
  expect(dto.reflectionEventHighWaterDto.safeParse(maximum).success).toBe(true);
  expect(dto.reflectionEventHighWaterDto.safeParse(maximum + 1).success).toBe(false);
});

it("publishes the exact int4 event bounds in generated request and worker schemas", () => {
  const append = z.toJSONSchema(dto.reflectionEventAppendInputDto, { io: "input" }) as unknown as { properties: { sequence: { minimum: number; maximum: number } } };
  const worker = z.toJSONSchema(dto.reflectionWorkerLoadOutputDto, { io: "output" }) as unknown as { properties: { last_event_sequence: { minimum: number; maximum: number } } };
  expect(append.properties.sequence).toMatchObject({ minimum: 1, maximum: dto.postgresInt4Max });
  expect(worker.properties.last_event_sequence).toMatchObject({ minimum: 0, maximum: dto.postgresInt4Max });
});

it("uses business actions instead of caller-selected status, time or workspace path", () => {
  expect(dto.reflectionTaskAdvanceInputDto.parse({ task_id: taskId, action: "finalize", expected_revision: 4, error_summary: null })).toEqual({ task_id: taskId, action: "finalize", expected_revision: 4, error_summary: null });
  for (const key of ["status", "started_at", "completed_at", "workspace_path", "user_id"])
    expect(dto.reflectionTaskAdvanceInputDto.safeParse({ task_id: taskId, action: "context-ready", expected_revision: 2, [key]: "caller" }).success, key).toBe(false);
});

it("keeps section Thread selection server-produced and report history lossless", () => {
  expect(dto.reflectionSectionBeginInputDto.safeParse({ task_id: taskId, section: "echoes", expected_revision: 1, thread_id: taskId }).success).toBe(false);
  expect(dto.reflectionSectionTranscriptInputDto.safeParse({ task_id: taskId, section: "echoes", thread_id: taskId }).success).toBe(false);
  const raw = '{"n":9007199254740993,"float":1.0,"text":"中文"}';
  expect(dto.analysisReportDto.parse({ id: "9007199254740993", report_type: "custom", report_data_json: raw, created_at: null }).report_data_json).toBe(raw);
});
