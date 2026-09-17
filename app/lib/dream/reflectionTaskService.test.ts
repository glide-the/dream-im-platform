// [Input] Fixed task aggregate rows, OAuth/background actors, private snapshot and receipt seams.
// [Output] Authorization, task/event binding, snapshot privacy, CAS and terminal report recovery evidence.
// [Pos] Provider-free Reflections domain test; no Registry, Route, PostgreSQL, Agent, network or files.
// [Sync] 2026-09-15: cover persisted event high-water recovery, serialized append and receipt replay.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
const mocks = vi.hoisted(() => ({
  create: vi.fn(), readOwned: vi.fn(), readForService: vi.fn(), adoptOwned: vi.fn(), insertMissingSections: vi.fn(), sections: vi.fn(), results: vi.fn(),
  latestOwned: vi.fn(), latestTerminalOwned: vi.fn(), sourceSessions: vi.fn(), customPrompts: vi.fn(), materializeLaunchSnapshot: vi.fn(), ensureWorkspacePath: vi.fn(), advance: vi.fn(),
  failPendingSections: vi.fn(), beginSection: vi.fn(), transcript: vi.fn(), finishSection: vi.fn(), appendEvent: vi.fn(), lastEventSequence: vi.fn(), events: vi.fn(), reports: vi.fn(),
  reportForTask: vi.fn(), insertReport: vi.fn(), saveAnalysisReport: vi.fn(), receiptExecute: vi.fn(), receiptFind: vi.fn(), receiptActors: [] as string[],
}));
vi.mock("./reflectionTaskRepository", () => ({ ReflectionTaskRepository: class {
  create = mocks.create; readOwned = mocks.readOwned; readForService = mocks.readForService; adoptOwned = mocks.adoptOwned; insertMissingSections = mocks.insertMissingSections;
  sections = mocks.sections; results = mocks.results; latestOwned = mocks.latestOwned; latestTerminalOwned = mocks.latestTerminalOwned; sourceSessions = mocks.sourceSessions;
  customPrompts = mocks.customPrompts; materializeLaunchSnapshot = mocks.materializeLaunchSnapshot; ensureWorkspacePath = mocks.ensureWorkspacePath; advance = mocks.advance; failPendingSections = mocks.failPendingSections;
  beginSection = mocks.beginSection; transcript = mocks.transcript; finishSection = mocks.finishSection; appendEvent = mocks.appendEvent; lastEventSequence = mocks.lastEventSequence; events = mocks.events;
  reports = mocks.reports; reportForTask = mocks.reportForTask; insertReport = mocks.insertReport; saveAnalysisReport = mocks.saveAnalysisReport;
} }));
vi.mock("./receipts", async original => ({ ...await original<typeof import("./receipts")>(), ReceiptRepository: class {
  constructor(_tx: unknown, _service: string, actor: string) { mocks.receiptActors.push(actor); }
  execute = mocks.receiptExecute; find = mocks.receiptFind;
} }));
import type { DataTransaction } from "./database";
import { readOriginalReflectionTaskBackgroundReceipt, reflectionTaskReceiptActor, runReflectionTaskBackgroundOperation, runReflectionTaskUserOperation } from "./reflectionTaskService";

const taskId = "11111111-1111-4111-8111-111111111111", threadId = "22222222-2222-4222-8222-222222222222";
const publicInput = { session_ids: ["session-1"], start_date: null, end_date: null, language: "en", language_label: "English" } as const;
const row = {
  id: taskId, userId: "9007199254740993", status: "CREATED", sectionsJson: '["echoes","traits","patterns"]', inputSnapshotJson: JSON.stringify(publicInput),
  workspacePath: null, agentContractVersion: "reflections-agent-v1", errorSummary: null, serviceClientId: "dream", authUserId: "oauth-subject", launchSnapshotJson: null, revision: 1,
  createdAt: "2026-09-15 00:00:00+00", startedAt: null, completedAt: null, updatedAt: "2026-09-15 00:00:00+00",
};
const sectionRows = ["echoes", "traits", "patterns"].map(section => ({ taskId, section, status: "PENDING", threadId: null, resultCount: 0, errorSummary: null, revision: 1, startedAt: null, completedAt: null }));
const principal = { subject: "oauth-subject", canonical_user_id: row.userId, client_id: "browser", scopes: ["dream:read", "dream:write"], status: "active" as const };
const actor = { principal, threadScope: null as null, editorSessionScope: null as null, runScope: null as null };
const service = { id: "dream", backgroundScopes: ["reflections:execute"] };
const tx = {} as DataTransaction;
const snapshot = { schema_version: 1, task_id: taskId, language: "en", sessions: [{ id: "session-1", name: "Entry", created_at: "2026-09-14T00:00:00+00:00", updated_at: "2026-09-14T00:00:00+00:00", labels: ["x"], first_line: "body", text: "body text" }], custom_prompts: [{ section: "echoes", prompt_files_json: null }, { section: "traits", prompt_files_json: null }, { section: "patterns", prompt_files_json: null }], stats: { days: 1, entries: 1, words: 2 } };

beforeEach(() => {
  vi.resetAllMocks(); mocks.receiptActors.length = 0;
  vi.stubEnv("DREAM_REFLECTION_REPORT_LIST_MAX_ROWS", "100");
  mocks.sections.mockResolvedValue(sectionRows); mocks.results.mockResolvedValue([]); mocks.reportForTask.mockResolvedValue(null);
  mocks.lastEventSequence.mockResolvedValue(0);
  mocks.ensureWorkspacePath.mockImplementation(async value => value);
  mocks.readOwned.mockResolvedValue(row); mocks.readForService.mockResolvedValue(row); mocks.adoptOwned.mockResolvedValue(row);
  mocks.receiptExecute.mockImplementation(async (_name: string, _request: string, _input: unknown, output: z.ZodType, action: () => Promise<unknown>) => output.parse(await action()));
  mocks.receiptFind.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

it("creates a service-bound task under the live OAuth owner with a subject receipt", async () => {
  mocks.create.mockResolvedValue(taskId);
  const output = await runReflectionTaskUserOperation("reflection-task.create", { sections: ["echoes", "traits", "patterns"], input_snapshot: publicInput }, actor, tx, "dream", "req-create");
  expect(mocks.create).toHaveBeenCalledExactlyOnceWith(row.userId, principal.subject, "dream", ["echoes", "traits", "patterns"], publicInput);
  expect(mocks.receiptActors).toEqual([principal.subject]); expect(output).toMatchObject({ task: { task_id: taskId }, results: [] });
});

it("uses explicit start to adopt a historical null service and materialize section bindings", async () => {
  const legacy = { ...row, serviceClientId: null }; mocks.readOwned.mockResolvedValueOnce(legacy).mockResolvedValueOnce(row); mocks.adoptOwned.mockResolvedValue(row);
  const output = await runReflectionTaskUserOperation("reflection-task.start", { task_id: taskId }, actor, tx, "dream", "req-start");
  expect(mocks.insertMissingSections).toHaveBeenCalledExactlyOnceWith(legacy, ["echoes", "traits", "patterns"]);
  expect(mocks.adoptOwned).toHaveBeenCalledExactlyOnceWith(taskId, row.userId, principal.subject, "dream"); expect(output).toMatchObject({ terminal: false, report_missing: false });
});

it("lists lossless report JSON with the legacy default and stable decimal ids", async () => {
  const raw = '{"echoes":[],"integer":9007199254740993,"float":1.0}';
  mocks.reports.mockResolvedValue([{ id: "9007199254740993", reportType: "full_analysis", reportDataJson: raw, createdAt: "2026-09-15 00:00:00+00" }]);
  const output = await runReflectionTaskUserOperation("analysis-report.list", {}, actor, tx, "dream", "read-unused");
  expect(mocks.reports).toHaveBeenCalledExactlyOnceWith(row.userId, 10);
  expect(output).toEqual({ reports: [{ id: "9007199254740993", report_type: "full_analysis", report_data_json: raw, created_at: "2026-09-15T00:00:00+00:00" }] });
  expect(mocks.receiptExecute).not.toHaveBeenCalled();
});

it("rejects report history above the configured operational capacity before storage", async () => {
  await expect(runReflectionTaskUserOperation("analysis-report.list", { limit: 101 }, actor, tx, "dream", "read-unused")).rejects.toMatchObject({ code: "REFLECTION_REPORT_LIMIT_EXCEEDED", status: 400 });
  expect(mocks.reports).not.toHaveBeenCalled();
});

it("saves lossless legacy report JSON under the OAuth owner with an empty omitted notes value", async () => {
  const raw = '{"echoes":[{"title":"中文"}],"integer":9007199254740993,"float":1.0}';
  const output = await runReflectionTaskUserOperation("analysis-report.save", { report_type: "echoes", report_data_json: raw }, actor, tx, "dream", "report-save");
  expect(mocks.saveAnalysisReport).toHaveBeenCalledExactlyOnceWith(row.userId, "echoes", raw, "");
  expect(output).toEqual({ success: true }); expect(mocks.receiptActors).toEqual([principal.subject]);
});

it("denies entity-scoped OAuth and background services without the exact executor scope before storage", async () => {
  await expect(runReflectionTaskUserOperation("reflection-task.get", { task_id: taskId }, { ...actor, threadScope: "thread" as never }, tx, "dream", "req")).rejects.toMatchObject({ code: "DELEGATION_ENTITY_DENIED", status: 403 });
  await expect(runReflectionTaskBackgroundOperation("reflection-report.ensure", { task_id: taskId }, { ...service, backgroundScopes: ["resource-observer:write"] }, tx, "req", { launchSnapshotMaxBytes: 10_000, workspaceRoot: "/private/tmp/reflections" })).rejects.toMatchObject({ code: "DREAM_SERVICE_SCOPE_REQUIRED", status: 403 });
  expect(mocks.readOwned).not.toHaveBeenCalled(); expect(mocks.readForService).not.toHaveBeenCalled();
});

it("materializes a bounded private snapshot while the receipt stores only its digest", async () => {
  mocks.sourceSessions.mockResolvedValue([{ id: "session-1", name: "Entry", stateJson: '{"cells":[{"type":"text","content":" body text "}]}', labelsJson: '["x"]', createdAt: "2026-09-14 00:00:00+00", updatedAt: "2026-09-14 00:00:00+00" }]);
  mocks.customPrompts.mockResolvedValue([]);
  const stored = { ...row, status: "ASSEMBLING", revision: 2, inputSnapshotJson: JSON.stringify({ ...publicInput, session_count: 1 }), launchSnapshotJson: JSON.stringify(snapshot), workspacePath: `/private/tmp/reflections/${taskId}/memory` };
  mocks.materializeLaunchSnapshot.mockResolvedValue(stored); mocks.readForService.mockResolvedValueOnce(row).mockResolvedValueOnce(stored);
  let receiptResult: unknown;
  mocks.receiptExecute.mockImplementationOnce(async (_name: string, _request: string, _input: unknown, output: z.ZodType, action: () => Promise<unknown>) => { receiptResult = output.parse(await action()); return receiptResult; });
  const output = await runReflectionTaskBackgroundOperation("reflection-task.worker-load", { task_id: taskId }, service, tx, "worker-1", { launchSnapshotMaxBytes: 20_000, workspaceRoot: "/private/tmp/reflections" });
  expect(receiptResult).toMatchObject({ task_id: taskId, revision: 2 }); expect(JSON.stringify(receiptResult)).not.toContain("body text");
  expect(output).toMatchObject({ launch_snapshot: { sessions: [{ text: "body text" }] }, task: { input_snapshot: { session_count: 1 } }, last_event_sequence: 0 });
  expect(mocks.receiptActors).toEqual([reflectionTaskReceiptActor(taskId)]);
});

it("restores the historical event high-water mark and locks the task before reading it", async () => {
  const stored = { ...row, status: "ASSEMBLING", revision: 2, inputSnapshotJson: JSON.stringify({ ...publicInput, session_count: 1 }), launchSnapshotJson: JSON.stringify(snapshot), workspacePath: `/private/tmp/reflections/${taskId}/memory` };
  mocks.readForService.mockResolvedValue(stored); mocks.lastEventSequence.mockResolvedValue(7);
  const output = await runReflectionTaskBackgroundOperation("reflection-task.worker-load", { task_id: taskId }, service, tx, "worker-restart", { launchSnapshotMaxBytes: 20_000, workspaceRoot: "/private/tmp/reflections" });
  expect(output).toMatchObject({ last_event_sequence: 7 });
  expect(mocks.readForService).toHaveBeenNthCalledWith(1, taskId, service.id, true);
  expect(mocks.lastEventSequence).toHaveBeenCalledExactlyOnceWith(taskId);
});

it("serializes same-task event appends through the locked task and replays without a second insert", async () => {
  const inputs = [1, 2].map(sequence => ({ task_id: taskId, event_id: `evt_${taskId.replaceAll("-", "")}_${String(sequence).padStart(6, "0")}`, sequence, event_type: "reflection.context.ready", created_at: `2026-09-15T00:00:0${sequence}Z`, payload: { sequence } }));
  const releases: (() => void)[] = []; let prior = Promise.resolve(), current = 0;
  mocks.readForService.mockImplementation(async (_task: string, _service: string, lock: boolean) => {
    expect(lock).toBe(true); const wait = prior; let unlock!: () => void; prior = new Promise<void>(resolve => { unlock = resolve; }); await wait; releases.push(unlock); return row;
  });
  mocks.appendEvent.mockImplementation(async (input: { sequence: number }) => { expect(input.sequence).toBe(current + 1); current = input.sequence; releases.shift()?.(); return inputs[input.sequence - 1].event_id; });
  const first = runReflectionTaskBackgroundOperation("reflection-event.append", inputs[0], service, tx, "event-1", { launchSnapshotMaxBytes: 20_000, workspaceRoot: "/private/tmp/reflections" });
  const second = runReflectionTaskBackgroundOperation("reflection-event.append", inputs[1], service, tx, "event-2", { launchSnapshotMaxBytes: 20_000, workspaceRoot: "/private/tmp/reflections" });
  await expect(Promise.all([first, second])).resolves.toEqual([expect.objectContaining({ accepted: true }), expect.objectContaining({ accepted: true })]);
  expect(mocks.appendEvent.mock.calls.map(call => call[0].sequence)).toEqual([1, 2]);

  mocks.receiptExecute.mockImplementationOnce(async (_name: string, _request: string, _input: unknown, output: z.ZodType) => output.parse({ event_id: inputs[1].event_id, accepted: true }));
  await expect(runReflectionTaskBackgroundOperation("reflection-event.append", inputs[1], service, tx, "event-2", { launchSnapshotMaxBytes: 20_000, workspaceRoot: "/private/tmp/reflections" })).resolves.toEqual({ event_id: inputs[1].event_id, accepted: true });
  expect(mocks.appendEvent).toHaveBeenCalledTimes(2);
  releases.shift()?.();
});

it("rejects a section result that cites a Session outside the immutable launch snapshot", async () => {
  const running = { ...row, status: "RUNNING", revision: 3, startedAt: "2026-09-15 00:01:00+00", launchSnapshotJson: JSON.stringify(snapshot) };
  mocks.readForService.mockResolvedValue(running);
  await expect(runReflectionTaskBackgroundOperation("reflection-section.finish", { task_id: taskId, section: "echoes", expected_revision: 2, outcome: "completed", results: [{ title: "t", description: "d", related_session_ids: ["foreign"], evidence: "e", confidence: "high" }] }, service, tx, "finish", { launchSnapshotMaxBytes: 20_000, workspaceRoot: "/private/tmp/reflections" })).rejects.toMatchObject({ code: "REFLECTION_RESULT_SESSION_DENIED", status: 400 });
  expect(mocks.finishSection).not.toHaveBeenCalled();
});

it("ensures a terminal report exactly once from task results and private stats", async () => {
  const terminal = { ...row, status: "COMPLETED", revision: 5, startedAt: "2026-09-15 00:01:00+00", completedAt: "2026-09-15 00:02:00+00", launchSnapshotJson: JSON.stringify(snapshot) };
  mocks.readForService.mockResolvedValue(terminal);
  mocks.sections.mockResolvedValue(sectionRows.map(item => ({ ...item, status: "COMPLETED", resultCount: 1, startedAt: "2026-09-15 00:01:00+00", completedAt: "2026-09-15 00:02:00+00" })));
  mocks.results.mockResolvedValue([{ id: "33333333-3333-4333-8333-333333333333", taskId, section: "echoes", title: "t", description: "d", relatedSessionIdsJson: '["session-1"]', evidence: "e", confidence: "high", createdAt: "2026-09-15 00:01:30+00" }]);
  mocks.insertReport.mockResolvedValue({ id: "9", reportType: "full_analysis" });
  const first = await runReflectionTaskBackgroundOperation("reflection-report.ensure", { task_id: taskId }, service, tx, "report-1", { launchSnapshotMaxBytes: 20_000, workspaceRoot: "/private/tmp/reflections" });
  expect(first).toEqual({ report_id: "9", report_type: "full_analysis", created: true });
  const body = mocks.insertReport.mock.calls[0][2] as string; expect(body).toContain('"stats":{"days":1,"entries":1,"words":2}'); expect(body).not.toContain("body text");
});

it("recovers only a same-service task-bound original receipt and rejects scoped corruption", async () => {
  mocks.receiptFind.mockResolvedValueOnce({ inputSha256: "a".repeat(64), result: { event_id: `evt_${taskId.replaceAll("-", "")}_000001`, accepted: true }, threadScope: null, editorSessionScope: null, runScope: null });
  expect(await readOriginalReflectionTaskBackgroundReceipt("reflection-event.append", taskId, "event-1", service, tx)).toMatchObject({ accepted: true });
  mocks.receiptFind.mockResolvedValueOnce({ inputSha256: "a".repeat(64), result: { event_id: "x", accepted: true }, threadScope: "thread", editorSessionScope: null, runScope: null });
  await expect(readOriginalReflectionTaskBackgroundReceipt("reflection-event.append", taskId, "event-2", service, tx)).rejects.toMatchObject({ code: "REFLECTION_RECEIPT_DATA_INVALID" });
});
