// [Input] Complete static Preflight rows and actual original source with fixed safe token authority.
// [Output] Full projection, exact UTC microseconds and token parity for the new public harness oracle.
// [Pos] Provider-free source adapter validation; no PostgreSQL or production credentials.
// [Sync] 2026-09-15: validate passed/read-active/read-expired/failed source projections without body diagnostics.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { validWorkflowPreflightRow } from "../../../tests/fixtures/workflowPreflight";
import { projectPreflightExecutionRow } from "./workflowPreflightExecutionService";
import { WorkflowTokenAuthority } from "./workflowTokenAuthority";
import { workflowPreflightDto } from "./workflowPreflightDto";

it.skipIf(!process.env.INK_DREAM_SOURCE)("matches all original fields and token bytes through the public harness source adapter", () => {
  const secret = "0123456789abcdef0123456789abcdef", authority = new WorkflowTokenAuthority(Buffer.from(secret));
  for (const kind of ["execute", "read-active", "read-expired", "failed"] as const) {
    const base = validWorkflowPreflightRow();
    const row = { ...base, updated_at: base.created_at, preflight_token_hash: null,
      request_fingerprint: `sha256:${"c".repeat(64)}`,
      ...(kind === "failed" ? { status: "failed", error_code: "RUNTIME_PLUGIN_NOT_READY", failed_check: "runtime_materialization" } : {}) };
    const mode = kind.startsWith("read") ? "read" : "execute";
    const clock = kind === "read-expired" ? row.expires_at : row.clock;
    const result = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/deckPluginMetadataOracle.py")],
      { env: process.env, input: JSON.stringify({ action: "preflight-projection", mode, row, clock, raw_input_json: null, secret }), encoding: "utf8", timeout: 10_000 });
    expect(result.status, "Original complete projection oracle must launch").toBe(0);
    const source = JSON.parse(result.stdout) as { preflight: unknown };
    const expected = workflowPreflightDto.parse(source.preflight);
    const projected = projectPreflightExecutionRow(row);
    const token = kind === "execute" || kind === "read-active" ? authority.issue({ ...projected, deck_runtime_snapshot_id: projected.deck_runtime_snapshot_id! }) : null;
    expect(projectPreflightExecutionRow(row, token)).toEqual(expected);
  }
});
