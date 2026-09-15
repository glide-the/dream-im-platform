// [Input] Verified canonical OAuth owner and original complete Preflight rows at the production ORM boundary.
// [Output] Original status/token/expiry/consumption/NULL projection and safe ownership/corruption failures.
// [Pos] Provider-free Preflight read/lifecycle verification; no SQL fixture or alternate grant protocol.
// [Sync] 2026-09-15: validate one-microsecond expiry and explicit Admin signing configuration.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./workflowPreflightRepository", () => ({ WorkflowPreflightRepository: class { read = mocks.read; } }));
import { readWorkflowPreflight } from "./workflowPreflightService";
import { workflowPreflightDto, workflowPreflightReadInputDto } from "./workflowPreflightDto";
import { validWorkflowPreflightRow } from "../../../tests/fixtures/workflowPreflight";
import { pgTimestampToIso } from "./chatThreadDto";
import type { DataTransaction } from "./database";
const row = validWorkflowPreflightRow();
const principal = { subject: "auth-user", canonical_user_id: row.created_by, client_id: "browser", scopes: ["dream:read"], status: "active" as const };
const input = { workflow_preflight_id: row.workflow_preflight_id };
const tx = {} as DataTransaction;
function projection() { const fields = Object.fromEntries(Object.entries(row).filter(([key]) => key !== "clock" && key !== "consumed_at")); return { ...fields, expires_at: pgTimestampToIso(row.expires_at), created_at: pgTimestampToIso(row.created_at), preflight_token: null }; }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("INK_WORKFLOW_TOKEN_SECRET", "0123456789abcdef0123456789abcdef"); mocks.read.mockResolvedValue(validWorkflowPreflightRow()); });
afterEach(() => vi.unstubAllEnvs());
describe("original owned Preflight read", () => {
  it("re-issues the original token only for an owned active passed Preflight", async () => {
    expect(await readWorkflowPreflight(tx, input, principal)).toEqual({ preflight: { ...projection(), preflight_token: "pft_a7e_q2jk5jk910oYV46ODBbuFeR0966z9d5vnMLTNFg" } });
    expect(mocks.read).toHaveBeenCalledWith(row.created_by, row.workflow_preflight_id);
  });
  it.each(["expired-clock", "exact-expiry", "consumed", "checking", "expired"])("returns original status and null token for %s without any mutation", async reason => {
    const changed = { ...row };
    if (reason === "expired-clock") changed.clock = "2026-09-14 00:00:00.123457+00";
    if (reason === "exact-expiry") changed.clock = row.expires_at;
    if (reason === "consumed") changed.consumed_at = row.clock;
    if (reason === "checking" || reason === "expired") changed.status = reason;
    mocks.read.mockResolvedValue(changed);
    expect(await readWorkflowPreflight(tx, input, principal)).toEqual({ preflight: { ...projection(), status: changed.status } });
  });
  it("keeps missing/current-owner mismatch forbidden and corrupt storage unavailable", async () => {
    mocks.read.mockResolvedValueOnce(null); await expect(readWorkflowPreflight(tx, input, principal)).rejects.toMatchObject({ code: "WORKFLOW_PERMISSION_DENIED", status: 403 });
    mocks.read.mockResolvedValueOnce({ ...row, created_by: "42" }); await expect(readWorkflowPreflight(tx, input, principal)).rejects.toMatchObject({ status: 403 });
    for (const changed of [{ ...row, status: "failed" }, { ...row, deck_runtime_snapshot_id: null }, { ...row, expires_at: row.created_at }, { ...row, created_at: "infinity" }, { ...row, consumed_at: "not-time" }]) {
      mocks.read.mockResolvedValueOnce(changed); await expect(readWorkflowPreflight(tx, input, principal)).rejects.toMatchObject({ code: "WORKFLOW_PREFLIGHT_DATA_INVALID", status: 503 });
    }
  });
  it("requires scope, closed actor-free lookup and explicit Admin authority configuration", async () => {
    await expect(readWorkflowPreflight(tx, input, { ...principal, scopes: [] })).rejects.toMatchObject({ status: 403 });
    for (const key of ["actor_id", "user_id", "table", "status", "preflight_token"]) expect(workflowPreflightReadInputDto.safeParse({ ...input, [key]: "selector" }).success).toBe(false);
    await expect(readWorkflowPreflight(tx, { ...input, actor_id: "external" }, principal)).rejects.toMatchObject({ status: 400 });
    vi.stubEnv("INK_WORKFLOW_TOKEN_SECRET", ""); await expect(readWorkflowPreflight(tx, input, principal)).rejects.toMatchObject({ status: 503 });
  });
});
describe("original complete Preflight lifecycle model", () => {
  it("preserves zero revision, nullable token and empty non-null snapshot/failure fields", () => {
    expect(workflowPreflightDto.safeParse({ ...projection(), binding_revision: 0, deck_runtime_snapshot_id: "", deck_runtime_snapshot_summary_hash: "" }).success).toBe(true);
    expect(workflowPreflightDto.safeParse({ ...projection(), status: "failed", error_code: "", failed_check: "runtime_materialization", deck_runtime_snapshot_id: null }).success).toBe(true);
  });
  it("rejects inconsistent token/failure/status/expiry facts without throwing from safeParse", () => {
    for (const changed of [{ status: "failed" }, { status: "checking", preflight_token: "token" }, { error_code: "error" }, { failed_check: "binding_release" }, { deck_runtime_snapshot_id: null }, { expires_at: projection().created_at }, { expires_at: "not-time" }]) expect(workflowPreflightDto.safeParse({ ...projection(), ...changed }).success).toBe(false);
  });
});
