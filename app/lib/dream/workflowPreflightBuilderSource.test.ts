// [Input] Original complete Manifest/Lock/Deck/Voice facts and an explicit read-only source interpreter.
// [Output] Actual builder binding and snapshot byte/hash/reuse parity through production ORM methods.
// [Pos] Provider-free fixed read injection; no SQL parser, database, provider or copied hashing algorithm.
// [Sync] 2026-09-15: verify the source capture adapter and separate original snapshot commit evidence.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { compatibilityFixture } from "../../../tests/fixtures/deckPluginCompatibility";
import { WorkflowPreflightDependencyRepository } from "./workflowPreflightDependencyRepository";
import type { DataTransaction } from "./database";
type Row = Record<string, unknown>;
function fixedTransaction(reads: Row[][], writes: Row[]) {
  return { select: () => {
    const rows = reads.shift();
    if (!rows) throw new Error("Unexpected fixed ORM read");
    const query = { from: () => query, innerJoin: () => query, where: () => query, limit: () => query, orderBy: () => query,
      for: () => Promise.resolve(rows), then: (fulfilled: (value: Row[]) => unknown) => Promise.resolve(rows).then(fulfilled) };
    return query;
  }, insert: () => ({ values: async (value: Row) => { writes.push(value); } }) } as unknown as DataTransaction;
}
beforeEach(() => vi.stubEnv("DREAM_DOMAIN_CANONICAL_TIMEOUT_MS", "10000"));
afterEach(() => vi.unstubAllEnvs());
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual original binding and fresh/reused snapshot canonical bytes", async () => {
  const f = compatibilityFixture();
  const snapshotBinding = { deck_plugin_binding_id: "binding_中文😀", binding_revision: 7,
    deck_plugin_id: f.input.deck_plugin_id, deck_plugin_version: f.input.deck_plugin_version };
  const binding = { ...snapshotBinding, deck_id: "deck" };
  const bindingRow = { ...binding, manifest_json: f.release.manifest_json, manifest_hash: f.release.manifest_hash,
    lock_json: f.lockFacts.lock_json, lock_manifest_hash: f.lockFacts.deck_plugin_manifest_hash };
  const deck = { id: "deck", name: "名字😀", name_zh: null, name_en: "Deck", description: "描述", description_zh: null, description_en: "" };
  const voices = [{ id: "voice_a", name: "声音", name_zh: null, name_en: "Voice", system_prompt: "正文😀\n" }];
  const freshWrites: Row[] = [];
  for (const reused of [false, true]) {
    const existing = reused ? { deck_runtime_snapshot_id: "drs_existing", sanitized_summary_hash: freshWrites[0].sanitized_summary_hash } : null;
    const source = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/deckPluginMetadataOracle.py")], {
      env: process.env, encoding: "utf8", timeout: 10_000, input: JSON.stringify({ action: "preflight-binding-snapshot",
        actor: { actor_id: "9007199254740993", workspace_id: "workspace" }, binding_row: bindingRow, deck_row: deck, voices,
        existing_snapshot: existing, raw_input_json: '{"负零":-0.0,"integer":9007199254740993}', secret: "0123456789abcdef0123456789abcdef" }) });
    expect(source.status, "Actual original builder capture adapter must launch").toBe(0);
    const oracle = JSON.parse(source.stdout) as { binding: { deck_runtime_profile_id: string; deck_runtime_snapshot_contract: string };
      snapshot: { sanitized_summary_hash: string; reused: boolean; deck_runtime_snapshot_id: string }; snapshot_insert: unknown[] | null;
      snapshot_commits: number; snapshot_rollbacks: number };
    const writes: Row[] = [], reads = [[bindingRow], [deck], [snapshotBinding], voices, existing === null ? [] : [existing]];
    const repository = new WorkflowPreflightDependencyRepository(fixedTransaction(reads, writes), "9007199254740993", "workspace");
    const actualBinding = await repository.binding("deck", 7);
    expect(actualBinding).toEqual(oracle.binding);
    const result = await repository.snapshot("deck", actualBinding.deck_runtime_profile_id, actualBinding.deck_runtime_snapshot_contract);
    expect({ sanitized_summary_hash: result.sanitized_summary_hash, reused: result.reused }).toEqual({ sanitized_summary_hash: oracle.snapshot.sanitized_summary_hash, reused });
    expect(oracle.snapshot_rollbacks).toBe(0); expect(reads).toHaveLength(0);
    if (reused) { expect(result).toEqual(oracle.snapshot); expect(writes).toHaveLength(0); expect(oracle.snapshot_insert).toBeNull(); expect(oracle.snapshot_commits).toBe(0); }
    else {
      expect(writes).toHaveLength(1); expect(result.deck_runtime_snapshot_id).toMatch(/^drs_[0-9a-f]{32}$/); expect(oracle.snapshot_commits).toBe(1);
      const fields = ["deck_id", "deck_plugin_binding_id", "binding_revision", "deck_runtime_profile_id", "snapshot_contract", "config_hash", "config_json", "sanitized_summary_hash"];
      expect(fields.map(key => writes[0][key])).toEqual(oracle.snapshot_insert?.slice(1));
      freshWrites.push(writes[0]);
    }
  }
});
