// [Input] Full original lock fixtures, JSON encodings and explicit read-only production source oracle.
// [Output] Strict required/default/date/SemVer/nested validation parity, without numeric hash re-encoding.
// [Pos] Provider-free metadata validation; harness source root is never used by production.
// [Sync] 2026-09-15: compare original Pydantic acceptance through the explicitly selected Dream oracle interpreter.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { compatibilityFixture } from "../../../tests/fixtures/deckPluginCompatibility";
import { deckRuntimePluginLockDto } from "./deckRuntimePluginLockDto";
const dateCases = ["2026-09-15", "2026-09-15 00:00:00", "2026-09-15t00:00:00z", "2026-09-15T00:00:00.1234567+00:00", "2026-09-15T00:00:00+08:00", "0", "-0.1234567", 0, 0.1234567, -0.1234567, 20_000_000_000, 20_000_000_001, -20_000_000_001,
  "2026-09-15T00:00", "2026-09-15T00:00Z", "2026-09-15T00:00:00+0830", "2026-09-15T00:00:00+23:59", "2026-09-15_00:00:00", "2026-09-15T00:00:00,123456Z", "2026-09-15T00:00:00.123456789+00:00", "+1", "1.", "-1.", ".1", "0001-01-01", 253_402_300_799_000, -62_135_596_800_000];
const invalidDates = [true, null, " 0 ", "2026-09-15T24:00:00", "2026-09-15T00:00:00+08:30:00", "2026-09-15T00:00:00+08", "2026-09-15T00:00:00+24:00", "2026-09-15X00:00:00", "2026-09-15T00:00:60", "2026-09-15T00:00:00.Z", "1e3", "0000-01-01", " 2026-09-15 ", -62_135_596_800_001, "2026-02-30", {}, []];
function cases() {
  const { lock } = compatibilityFixture();
  const missing = { ...lock, claude_code_plugins: [{ ...lock.claude_code_plugins[0], required: undefined }] };
  return [lock, ...[...dateCases, ...invalidDates].map(created_at => ({ ...lock, created_at })), missing,
    { ...lock, production_ready: "YES", claude_code_plugins: [{ ...lock.claude_code_plugins[0], required: "off", artifact_digest: "" }] },
    { ...lock, deck_plugin_id: "", deck_plugin_version: "" }, { ...lock, extra: true },
    { ...lock, claude_code_plugins: [{ ...lock.claude_code_plugins[0], source_ref: "\u001c source \u001c", resolved_version: "1.2٣.0", capability_bindings: ["\u001c a \u001c"] }] },
    { ...lock, claude_code_plugins: [{ ...lock.claude_code_plugins[0], resolved_version: "01.0.0" }] },
    { ...lock, claude_code_plugins: [{ ...lock.claude_code_plugins[0], extra: true }] }];
}
describe("original RuntimePluginLock model", () => {
  it("preserves original required entry flag and optional top-level defaults", () => {
    const { lock } = compatibilityFixture(); const value = deckRuntimePluginLockDto.parse(lock);
    expect(value.production_ready).toBe(false); expect(value.production_readiness_reasons).toEqual([]); expect(value.claude_code_plugins[0].capability_bindings).toEqual([]);
    expect(deckRuntimePluginLockDto.safeParse({ ...lock, claude_code_plugins: [{ ...lock.claude_code_plugins[0], required: undefined }] }).success).toBe(false);
  });
  it.each(dateCases)("retains persisted legacy datetime acceptance for %s", created_at => expect(deckRuntimePluginLockDto.safeParse({ ...compatibilityFixture().lock, created_at }).success).toBe(true));
  it.each(invalidDates)("rejects malformed persisted datetime %j", created_at => expect(deckRuntimePluginLockDto.safeParse({ ...compatibilityFixture().lock, created_at }).success).toBe(false));
  it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual original Pydantic acceptance and normalized non-date fields", () => {
    const inputs = cases(); const oracle = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", [resolve(process.cwd(), "tests/integration/deckPluginMetadataOracle.py")], { input: JSON.stringify({ action: "lock", cases: inputs }), encoding: "utf8", env: process.env, timeout: 10_000 });
    expect(oracle.status, "Original read-only source oracle must launch").toBe(0);
    const results = JSON.parse(oracle.stdout) as Array<{ accepted: boolean; value?: unknown }>;
    expect(results.length).toBe(inputs.length);
    inputs.forEach((input, index) => { const value = deckRuntimePluginLockDto.safeParse(input); expect(value.success, `Original lock acceptance case ${index}`).toBe(results[index].accepted);
      if (value.success) { const { created_at: _date, ...fields } = value.data; expect(fields, `Original normalized lock case ${index}`).toEqual(results[index].value); } });
  });
});
