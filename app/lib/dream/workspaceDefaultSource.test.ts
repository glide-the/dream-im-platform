// [Input] Actual original Python default Workspace helper with fixed results and explicit source/Python paths.
// [Output] Full fresh/existing/legacy/error source parameters and transaction parity.
// [Pos] Provider-free adapter validation; no SQL execution, algorithm copy or Runtime.
// [Sync] 2026-09-15: run source parity only with explicit Dream source and oracle interpreter.
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { workspaceDefaultPolicy } from "../../../config/workspace-default-policy";
it.skipIf(!process.env.INK_DREAM_SOURCE || !process.env.INK_DREAM_ORACLE_PYTHON)("matches actual fresh, existing legacy and rollback source calls", () => {
  const source = process.env.INK_DREAM_SOURCE, python = process.env.INK_DREAM_ORACLE_PYTHON;
  expect(source).toBeTruthy(); expect(python).toBeTruthy();
  const actor = "9007199254740993", uuid = "3183f39f-87f2-4603-b460-5376b79d5a71";
  const result = spawnSync(python!, ["tests/integration/workspaceDefaultSourceOracle.py"], {
    input: JSON.stringify({cases: [{actor, uuid, existing: null}, {actor, uuid, existing: "legacy-workspace"}, {actor, uuid, existing: null, fail_insert: true}]}),
    encoding: "utf8", env: {PATH: process.env.PATH, INK_DREAM_SOURCE: source} as unknown as NodeJS.ProcessEnv,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
    {result: uuid, error: null, parameters: [[actor], [uuid, workspaceDefaultPolicy.name, actor, "{}"]], commits: 1, rollbacks: 0},
    {result: "legacy-workspace", error: null, parameters: [[actor]], commits: 0, rollbacks: 0},
    {result: null, error: "Unable to create the default workspace", parameters: [[actor], [uuid, workspaceDefaultPolicy.name, actor, "{}"]], commits: 0, rollbacks: 1},
  ]);
});
