// [Input] Actual Dream picture helpers through the fixed source oracle and Registry103 DTOs.
// [Output] Legacy list/range/full mapping, parameter/order and reviewed strict-date parity.
// [Pos] Cross-project source gate; it opens no pool and uses no provider, writes or real data.
// [Sync] 2026-09-15: bind two Admin operations to all three old current-user read routes.
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { pictureHistoryListInputDto, pictureHistoryFullInputDto } from "./pictureHistoryDto";

const sourceRoot = process.env.INK_DREAM_SOURCE, python = process.env.INK_DREAM_ORACLE_PYTHON;

it.skipIf(!sourceRoot || !python)("matches the actual Dream picture source and freezes the strict Admin boundary", () => {
  const request = {
    actor: 7, limit: 30, start_date: "2026-09-01", end_date: "2026-09-15", full_date: "2026-09-15", missing_date: "2026-09-13",
    recent_rows: [
      { date: "2026-09-15", base64: "thumbnail", prompt: null, created_at: "2026-09-15T00:00:00+00:00" },
      { date: "2026-09-14", base64: "full-fallback", prompt: "prompt", created_at: null },
    ],
    range_rows: [
      { date: "2026-09-15", base64: "thumbnail", prompt: null, created_at: "2026-09-15T00:00:00+00:00" },
    ],
    full_row: { image_base64: "full-newest" },
  };
  const child = spawnSync(python!, ["-B", "tests/integration/pictureHistorySourceOracle.py"], {
    encoding: "utf8", timeout: 20_000, env: { PATH: process.env.PATH, INK_DREAM_SOURCE: sourceRoot } as unknown as NodeJS.ProcessEnv,
    input: JSON.stringify(request),
  });
  expect(child.error, "Actual Dream interpreter must launch").toBeUndefined();
  expect(child.status, child.stderr || "Actual source must finish").toBe(0);
  const output = JSON.parse(child.stdout) as {
    recent_result: typeof request.recent_rows;
    range_result: typeof request.range_rows;
    full_result: string | null;
    missing_result: string | null;
    recent: { statements: string[]; parameters: unknown[][]; closes: number };
    range: { statements: string[]; parameters: unknown[][]; closes: number };
    full: { statements: string[]; parameters: unknown[][]; closes: number };
    missing: { statements: string[]; parameters: unknown[][]; closes: number };
  };
  expect(output.recent_result).toEqual([
    { ...request.recent_rows[0], prompt: "" }, request.recent_rows[1],
  ]);
  expect(output.range_result).toEqual(request.range_rows);
  expect(output.full_result).toBe("full-newest"); expect(output.missing_result).toBeNull();
  expect(output.recent.parameters).toEqual([[7, 30]]);
  expect(output.range.parameters).toEqual([[7, "2026-09-01", "2026-09-01", "2026-09-15", "2026-09-15", 30]]);
  expect(output.full.parameters).toEqual([[7, "2026-09-15"]]);
  expect(output.recent.statements[0]).toContain("COALESCE(thumbnail_base64, image_base64)");
  expect(output.range.statements[0]).toContain("ORDER BY date DESC");
  expect(output.full.statements[0]).toContain("ORDER BY created_at DESC");
  expect([output.recent.closes, output.range.closes, output.full.closes, output.missing.closes]).toEqual([1, 1, 1, 1]);
  expect(pictureHistoryListInputDto.parse({ start_date: request.start_date, end_date: request.end_date, limit: request.limit })).toEqual({ start_date: request.start_date, end_date: request.end_date, limit: request.limit });
  expect(pictureHistoryFullInputDto.parse({ date: request.full_date })).toEqual({ date: request.full_date });
  // Reviewed boundary: Admin accepts only real YYYY-MM-DD dates and derives actor ownership from OAuth.
});
