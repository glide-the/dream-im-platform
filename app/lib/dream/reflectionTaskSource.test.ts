// [Input] Actual Dream Reflections helper source through a captured Python connection and fixed Unicode facts.
// [Output] Result validation, report shape, write transaction and JSON projection parity evidence.
// [Pos] Cross-project source gate; no Registry, Route, PostgreSQL, filesystem write, provider or real user data.
// [Sync] 2026-09-15: freeze original task/result/event/report semantics and explicit candidate deltas.
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { analysisReportSaveInputDto, reflectionInsightInputDto } from "./reflectionTaskDto";

const sourceRoot = process.env.INK_DREAM_SOURCE, python = process.env.INK_DREAM_ORACLE_PYTHON;
it.skipIf(!sourceRoot || !python)("matches the actual Dream Reflections source while isolating reviewed aggregate deltas", () => {
  const taskId = "11111111-1111-4111-8111-111111111111", userId = "9007199254740993";
  const input = {
    validation: {
      section: "echoes", sessions: [{ id: "s-1" }, { id: "s-2" }],
      results: [
        { title: "T".repeat(201), description: "D".repeat(4001), related_session_ids: ["s-1", "foreign"], evidence: "E".repeat(2001), confidence: "unknown" },
        { title: "dropped", related_session_ids: ["foreign"] },
      ],
    },
    report: {
      context: { task_id: taskId, user_id: userId, sessions: [{ id: "s-1", created_at: "2026-09-14T01:00:00Z", text: "two words" }, { id: "s-2", updated_at: "2026-09-14T02:00:00Z", text: "中文 内容" }] },
      completed_sections: ["echoes"], persisted: [{ id: "r-1", section: "echoes", title: "标题", related_session_ids: ["s-1"] }],
    },
    database_calls: [
      { action: "create", task_id: taskId, user_id: userId, sections: ["echoes"], input_snapshot: { language: "zh", session_ids: ["s-1"] } },
      { action: "status", task_id: taskId, status: "FAILED", error_summary: "boom", completed_at: "2026-09-15T00:00:00+00:00" },
      { action: "replace", task_id: taskId, user_id: userId, section: "echoes", result_ids: ["33333333-3333-4333-8333-333333333333"], results: [{ title: "标题", description: "描述", related_session_ids: ["s-1"], evidence: "证据", confidence: "high" }] },
      { action: "event", task_id: taskId, event_type: "reflection.task.failed", event_id: "evt_000001", sequence: 1, created_at: "2026-09-15T00:00:00+00:00", payload: { message: "失败😀" } },
      { action: "report-save", user_id: userId, report_type: "echoes", report_data_json: '{"integer":9007199254740993,"float":1.0,"echoes":[{"title":"标题"}]}', all_notes_text: "" },
      { action: "report-list", user_id: userId, limit: 10, rows: [{ id: 9, report_type: "echoes", report_data_json: '{"echoes":[{"title":"标题"}]}', created_at: "2026-09-15T00:00:00+00:00" }] },
    ],
    decode: {
      task: { id: taskId, status: "COMPLETED", sections: '["echoes"]', input_snapshot: '{"language":"zh"}' },
      result: { id: "r-1", related_session_ids: '["s-1"]' },
      event: { id: "evt_000001", payload: '{"message":"失败😀"}' },
    },
  };
  const child = spawnSync(python!, ["-B", "tests/integration/reflectionTaskSourceOracle.py"], { encoding: "utf8", timeout: 20_000,
    env: { PATH: process.env.PATH, INK_DREAM_SOURCE: sourceRoot } as unknown as NodeJS.ProcessEnv, input: JSON.stringify(input) });
  expect(child.error, "Actual original interpreter must launch").toBeUndefined(); expect(child.status, "Actual original source must complete without printing body/stderr").toBe(0);
  const output = JSON.parse(child.stdout) as { validated: Record<string, unknown>[]; report_calls: unknown[][]; database_calls: { result: unknown; parameters: unknown[][]; statements: string[]; commits: number; closes: number }[]; decoded: Record<string, Record<string, unknown>> };
  expect(output.validated).toHaveLength(1); expect(output.validated[0]).toMatchObject({ section: "echoes", title: "T".repeat(200), description: "D".repeat(4000), related_session_ids: ["s-1"], evidence: "E".repeat(2000), confidence: "low" });
  const { section: _section, ...validatedInsight } = output.validated[0]; void _section; expect(reflectionInsightInputDto.parse(validatedInsight)).toEqual(validatedInsight);
  expect(output.report_calls).toEqual([[userId, "reflections_echoes", { echoes: input.report.persisted, traits: [], patterns: [], stats: { days: 1, entries: 2, words: 4 } }]]);
  expect(output.database_calls.map(item => [item.commits, item.closes])).toEqual([[1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [0, 1]]);
  expect(output.database_calls[0].parameters[0]).toEqual([taskId, userId, '["echoes"]', '{"language": "zh", "session_ids": ["s-1"]}', "reflections-agent-v1"]);
  expect(output.database_calls[2].statements).toHaveLength(2); expect(output.database_calls[3].result).toBe("evt_000001");
  const rawReport = input.database_calls[4].report_data_json;
  expect(output.database_calls[4].parameters[0][2]).toBe('{"integer": 9007199254740993, "float": 1.0, "echoes": [{"title": "\\u6807\\u9898"}]}');
  expect(analysisReportSaveInputDto.parse({ report_type: "echoes", report_data_json: rawReport }).report_data_json).toBe(rawReport);
  expect(output.database_calls[5].result).toEqual([{ id: 9, report_type: "echoes", created_at: "2026-09-15T00:00:00+00:00", report_data: { echoes: [{ title: "标题" }] } }]);
  expect(output.decoded.task).toMatchObject({ sections: ["echoes"], input_snapshot: { language: "zh" } });
  expect(output.decoded.result.related_session_ids).toEqual(["s-1"]); expect(output.decoded.event.payload).toEqual({ message: "失败😀" });
  // Reviewed deltas: Admin binds owner/service/subject, adds section CAS and hard authority expiry,
  // uses task-bound event ids with conflict detection, and links reports exactly once.
});
