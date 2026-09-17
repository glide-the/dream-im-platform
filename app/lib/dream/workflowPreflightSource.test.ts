// [Input] Read-only actual Dream PreflightService and raw numeric/Unicode request cases.
// [Output] Original input/fingerprint SHA byte parity through production canonical codec.
// [Pos] Provider-free actual source oracle; no copied business algorithms or database.
// [Sync] 2026-09-15: prove raw float/decimal/negative-zero/Unicode and canonical actor semantics.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { canonicalBusinessJson } from "./deckContentCanonical";
beforeEach(() => vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000"));
afterEach(() => vi.unstubAllEnvs());
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual original Preflight input and fingerprint bytes", async () => {
  const cases = ['{}', '{"v":-0.0}', '{"v":0}', '{"v":0.0}', '{"v":9007199254740993}', '{"v":1e-7}', '{"v":1e100}',
    '{"中文":"😀","v":[true,null,{"x":1.2345678901234567}]}', '{"\\ud83d\\ude00":1,"\\ue000":2}', '{"v":1e400}', '{"v":NaN}']
    .map(input_json => ({ input_json, deck_id: "deck_中文😀", binding_revision: 7, actor: "9007199254740993" }));
  const oracle = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/deckPluginMetadataOracle.py")], {
    input: JSON.stringify({ action: "preflight-pure", cases }), env: process.env, encoding: "utf8", timeout: 10_000 });
  expect(oracle.status, "Original PreflightService oracle must launch").toBe(0);
  const results = JSON.parse(oracle.stdout) as Array<{ accepted: boolean; input_hash?: string; fingerprint?: string }>;
  expect(results.length).toBe(cases.length);
  for (const [index, item] of cases.entries()) {
    if (!results[index].accepted) { await expect(canonicalBusinessJson(item.input_json)).rejects.toThrow(); continue; }
    const canonical = await canonicalBusinessJson(item.input_json);
    expect(canonical.content_hash, `original input hash ${index}`).toBe(results[index].input_hash);
    const fingerprint = await canonicalBusinessJson(JSON.stringify({ deck_id: item.deck_id, binding_revision: item.binding_revision, input_hash: canonical.content_hash, actor: item.actor }));
    expect(fingerprint.content_hash, `original fingerprint ${index}`).toBe(results[index].fingerprint);
  }
});
