// [Input] Actual three Dream section-config functions with fixed original query results and owner.
// [Output] Eleven full source result/parameter/commit/close vectors without JSON number conversion.
// [Pos] Source-only evidence; no live pool, SQL interpretation, provider, filesystem or normal user.
// [Sync] 2026-09-15: run Registry83 source parity only with explicit Dream source and oracle interpreter.
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
it.skipIf(!process.env.INK_DREAM_SOURCE || !process.env.INK_DREAM_ORACLE_PYTHON)("matches eleven entire original get/save/delete source vectors including bigint-safe parameters and close on failure", () => {
  const sourceRoot = process.env.INK_DREAM_SOURCE, python = process.env.INK_DREAM_ORACLE_PYTHON;
  expect(sourceRoot).toBeTruthy(); expect(python).toBeTruthy();
  const actor = "9007199254740993", section = "echoes", input = { actor, section };
  const parameter = (values: unknown[]) => ({ actor_decimal: actor, actor_type: "int", values });
  const get = (row: unknown, result: string) => ({ input: { ...input, action: "get", row }, output: { result_json: result, error: null, parameters: [parameter([section])], commits: 0, closes: 1 } });
  const raw = '{"WORKFLOW.md": "原文😀", "MEMORY_QUERY_PROMPT.md": "问"}';
  const write = (action: string, result: string, controls: Record<string, unknown> = {}) => ({ input: { ...input, action, prompt_files_json: raw, ...controls },
    output: { result_json: result, error: null, parameters: [parameter(action === "save" ? [section, raw] : [section])], commits: 1, closes: 1 } });
  const vectors = [get(null, "null"), get({ prompt_files: "" }, "{}"), get({ prompt_files: "{}" }, "{}"),
    get({ prompt_files: '{"unknown":9007199254740993,"float":1.0,"negative":-0.0,"WORKFLOW.md":"保留😀"}' }, '{"unknown": 9007199254740993, "float": 1.0, "negative": -0.0, "WORKFLOW.md": "保留😀"}'),
    get({ prompt_files: "broken" }, "null"), get({ prompt_files: "[]" }, "null"), get({ prompt_files: 4 }, "null"),
    write("save", "null"), write("delete", "false", { rowcount: 0 }), write("delete", "true", { rowcount: 1 }),
    { input: { ...input, action: "save", prompt_files_json: raw, execute_error: true }, output: { result_json: null, error: "RuntimeError", parameters: [parameter([section, raw])], commits: 0, closes: 1 } }];
  expect(vectors).toHaveLength(11);
  const child = spawnSync(python!, ["-B", "tests/integration/reflectionsSectionConfigOracle.py"], { encoding: "utf8", timeout: 20000,
    env: { PATH: process.env.PATH, INK_DREAM_SOURCE: sourceRoot } as unknown as NodeJS.ProcessEnv, input: JSON.stringify({ cases: vectors.map(value => value.input) }) });
  expect(child.error, "Actual original interpreter must launch").toBeUndefined(); expect(child.status, "Original source must complete without printing stderr/body").toBe(0);
  expect(JSON.parse(child.stdout)).toEqual(vectors.map(value => value.output));
});
