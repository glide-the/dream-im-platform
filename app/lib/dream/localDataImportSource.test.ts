// [Input] Actual Dream import helpers through the fixed source oracle and reviewed Admin normalized DTO.
// [Output] Legacy aggregate/first-login parity plus explicit owner-transfer and ignored-time deltas.
// [Pos] Cross-project source gate; it opens no pool and uses no provider, filesystem write or real data.
// [Sync] 2026-09-15: bind Registry101 to the three old routes' persistence semantics before consumer wiring.
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { localDataImportInputDto } from "./localDataImportDto";

const sourceRoot = process.env.INK_DREAM_SOURCE, python = process.env.INK_DREAM_ORACLE_PYTHON;
it.skipIf(!sourceRoot || !python)("matches the actual Dream aggregate and first-login source while freezing reviewed deltas", () => {
  const actor = "9007199254740993", legacyTimestamp = 1_757_913_600_123;
  const request = {
    aggregate: {
      actor,
      sessions: [{ id: "session", name: "Session", editor_state_json: '{"counter":9007199254740993,"float":1.0}' }],
      pictures: [{ date: "2026-09-15", image_base64: "image", prompt: "prompt" }],
      preferences: { voice_configs_json: '{"counter":9007199254740993,"float":1.0}', meta_prompt: "meta", state_config_json: '{"state":1}', selected_state: "focused" },
      reports: [{ type: "patterns", data_json: '{"counter":9007199254740993,"float":1.0}', allNotes: "notes", timestamp: legacyTimestamp }],
    },
    first_login: [{ actor, existing: false }, { actor, existing: true }],
  };
  const child = spawnSync(python!, ["-B", "tests/integration/localDataImportSourceOracle.py"], {
    encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH, INK_DREAM_SOURCE: sourceRoot } as unknown as NodeJS.ProcessEnv,
    input: JSON.stringify(request),
  });
  expect(child.error, "Actual Dream interpreter must launch").toBeUndefined();
  expect(child.status, "Actual source must finish without stderr or body logging").toBe(0);
  const output = JSON.parse(child.stdout) as {
    aggregate: { statements: string[]; parameters: unknown[][]; commits: number; closes: number };
    first_login: { existing: boolean; statements: string[]; parameters: unknown[][]; commits: number; closes: number }[];
  };
  expect(output.aggregate.statements).toHaveLength(4);
  expect(output.aggregate.statements[0]).toContain("user_id = excluded.user_id");
  expect(output.aggregate.parameters.map(values => values[0])).toEqual(["session", actor, actor, actor]);
  expect(output.aggregate.parameters[3]).toHaveLength(4);
  expect(output.aggregate.commits).toBe(1); expect(output.aggregate.closes).toBe(1);
  expect(output.first_login.map(item => [item.existing, item.statements.length, item.commits, item.closes])).toEqual([[false, 2, 1, 1], [true, 2, 1, 1]]);
  const normalized = {
    sessions: [{ id: "session", name: "Session", editor_state: '{"counter":9007199254740993,"float":1.0}' }],
    pictures: request.aggregate.pictures,
    preferences: { voice_configs: '{"counter":9007199254740993,"float":1.0}', meta_prompt: "meta", state_config: '{"state":1}', selected_state: "focused" },
    reports: [{ type: "patterns", data: '{"counter":9007199254740993,"float":1.0}', all_notes: "notes", timestamp: new Date(legacyTimestamp).toISOString() }],
  };
  expect(localDataImportInputDto.parse(normalized)).toEqual(normalized);
  // Reviewed deltas: Admin denies the captured owner-transfer clause and persists normalized report time.
});
