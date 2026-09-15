// [Input] Actual original read/token service with legacy raw opaque binding strings and a safe fixed authority.
// [Output] Raw signing bytes and normalized full display projection independently match original source.
// [Pos] Provider-free source regression for read/reuse/final authority call sites; no PostgreSQL or body diagnostics.
// [Sync] 2026-09-15: distinguish stored lock/snapshot/input-hash strings from Pydantic output normalization.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./workflowPreflightRepository", () => ({ WorkflowPreflightRepository: class { read = mocks.read; } }));
import { validWorkflowPreflightRow } from "../../../tests/fixtures/workflowPreflight";
import { readWorkflowPreflight } from "./workflowPreflightService";
import { WorkflowTokenAuthority } from "./workflowTokenAuthority";
import { workflowPreflightDto } from "./workflowPreflightDto";
import type { DataTransaction } from "./database";
afterEach(() => vi.unstubAllEnvs());
it.skipIf(!process.env.INK_DREAM_SOURCE)("preserves raw lock/snapshot/hash token bindings before normalized full original output", async () => {
  const secret = "0123456789abcdef0123456789abcdef";
  vi.stubEnv("INK_WORKFLOW_TOKEN_SECRET", secret);
  const authority = new WorkflowTokenAuthority(Buffer.from(secret));
  const base = validWorkflowPreflightRow();
  for (const field of ["runtime_plugin_lock_id", "deck_runtime_snapshot_id", "input_hash"] as const) {
    const row = { ...base, [field]: ` ${base[field]} ` };
    const result = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", ["-B", resolve(process.cwd(), "tests/integration/deckPluginMetadataOracle.py")],
      { env: process.env, encoding: "utf8", timeout: 10_000, input: JSON.stringify({ action: "preflight-projection", mode: "read", row,
        raw_input_json: null, clock: row.clock, secret }) });
    expect(result.status, "Actual original raw-binding oracle must launch").toBe(0);
    const source = workflowPreflightDto.parse(JSON.parse(result.stdout).preflight);
    expect(authority.issueStored(row)).toBe(source.preflight_token);
    mocks.read.mockResolvedValue(row);
    const actual = await readWorkflowPreflight({} as DataTransaction, { workflow_preflight_id: row.workflow_preflight_id },
      { subject: "subject", canonical_user_id: row.created_by, client_id: "browser", scopes: ["dream:read"], status: "active" });
    expect(actual.preflight).toEqual(source);
    expect(actual.preflight[field]).toBe(base[field]);
  }
});
