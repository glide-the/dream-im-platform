// [Input] Fixed complete original Run/envelope facts and explicit read-only source interpreter.
// [Output] Actual whole failure recorder boundaries and pure metadata numeric-preserving parity.
// [Pos] Unregistered source/codec preparation; no PG, Runtime or public failure API is attached.
// [Sync] 2026-09-15: retain original failed Run commit across subsequent envelope failure.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
const clock = "2026-09-15T00:00:00.123456+00:00", messageId = "message", threadId = "thread", errorCode = "AGENT_TERMINAL_ERROR";
const run = { ...validWorkflowRun(), source_message_id: messageId, source_voice_thread_id: threadId, source_message_time: clock };
const { workflow_run_id: runId, ...fields } = run;
const queued = { ...fields, id: runId }, failed = { ...queued, status: "failed", status_version: 3, completed_at: clock, failed_step: "dream_agent_dispatch", error_code: errorCode };
const initial = { workspace_id: run.workspace_id, source_voice_thread_id: threadId, source_message_id: messageId };
const metadata = '{"kind":"story-workspace-dream-launch/v1","dispatchStatus":"dispatching","dispatchClaimId":"prior","dispatchClaimedAt":"prior","integer":9007199254740993,"float":1.0,"negative":-0.0,"nested":{"中文😀":9007199254740995}}';
const arguments_ = { workflow_run_id: runId, actor_id: run.created_by, message_id: messageId, error_code: errorCode };
function child(file: string, input: unknown, source = true) {
  const result = spawnSync(source ? process.env.INK_DREAM_ORACLE_PYTHON ?? "python3" : "python3", ["-B", ...(source ? [] : ["-I", "-S"]), resolve(process.cwd(), file)],
    { encoding: "utf8", timeout: 15000, input: JSON.stringify(input),
      env: { PATH: process.env.PATH, ...(source ? { INK_DREAM_SOURCE: process.env.INK_DREAM_SOURCE } : {}) } as unknown as NodeJS.ProcessEnv });
  expect((result.error as NodeJS.ErrnoException | undefined)?.code ?? null).toBeNull(); expect(result.status, "Fixed helper must complete without publishing private stderr/body").toBe(0);
  return JSON.parse(result.stdout) as unknown;
}
const resultDto = z.strictObject({ parameters: z.array(z.array(z.unknown())), events: z.array(z.string()), commits: z.number(), rollbacks: z.number(), closed: z.number() });
function original(rows: unknown[], faultAt: number | null = null) {
  return resultDto.parse(child("tests/integration/dreamLaunchFailureOracle.py", { rows, fault_at: faultAt, clock,
    uuid: "11111111111111111111111111111111", secret: "explicit-source-secret-32-characters", arguments: arguments_ }));
}
function overlay(text: string | null) {
  return z.strictObject({ metadata_json: z.string() }).parse(child("app/lib/dream/dreamLaunchFailureEnvelope.py", { metadata: text, error_code: errorCode }, false)).metadata_json;
}
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual entire failure recorder and actual FAILED transition before independent metadata COMMIT", () => {
  const actual = original([initial, queued, null, queued, null, null, failed, null, { metadata }, null]);
  expect(actual.parameters[0]).toEqual([runId, run.created_by]);
  expect(actual.parameters[4]).toEqual(["failed", 3, null, null, "dream_agent_dispatch", errorCode, "failed", clock, true, clock, runId, "queued", 2]);
  expect(actual.parameters[5]).toContain("dream_agent_terminal_error"); expect(actual.parameters[5]).toContain("dream_agent_dispatch");
  expect(actual.parameters[8]).toEqual([messageId, threadId]); expect(actual.parameters[9]).toEqual([overlay(metadata), messageId]);
  expect([actual.commits, actual.rollbacks, actual.closed]).toEqual([2, 2, 1]);
  expect(actual.events).toEqual(["execute", "rollback", "execute", "rollback", "execute", "execute", "execute", "execute", "execute", "commit", "execute", "execute", "execute", "commit", "close"]);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("retains original already-FAILED read rollback and only the envelope commit", () => {
  const actual = original([initial, failed, null, { metadata }, null]);
  expect([actual.commits, actual.rollbacks, actual.closed]).toEqual([1, 2, 1]); expect(actual.parameters).toHaveLength(5);
  expect(actual.parameters[4]).toEqual([overlay(metadata), messageId]);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("missing Run and mismatched original message silently roll back lookup without writes", () => {
  for (const row of [null, { ...initial, source_message_id: "different" }]) {
    const actual = original([row]); expect(actual.parameters).toEqual([[runId, run.created_by]]); expect(actual.events).toEqual(["execute", "rollback", "close"]);
    expect([actual.commits, actual.rollbacks, actual.closed]).toEqual([0, 1, 1]);
  }
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("illegal terminal transition preserves the original no-op instead of marking hidden metadata", () => {
  const cancelled = { ...queued, status: "cancelled", completed_at: clock };
  const actual = original([initial, cancelled, null, cancelled]);
  expect([actual.commits, actual.rollbacks, actual.closed]).toEqual([0, 3, 1]); expect(actual.parameters).toHaveLength(4); expect(actual.events.at(-1)).toBe("close");
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("missing message retains FAILED transition and independent empty metadata commit", () => {
  const actual = original([initial, queued, null, queued, null, null, failed, null, null]);
  expect([actual.commits, actual.rollbacks, actual.closed]).toEqual([2, 2, 1]); expect(actual.parameters).toHaveLength(9);
  expect(actual.events.slice(-4)).toEqual(["execute", "execute", "commit", "close"]);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("envelope UPDATE failure rolls back only its stage after the actual FAILED Run commit", () => {
  const actual = original([initial, queued, null, queued, null, null, failed, null, { metadata }], 10);
  expect([actual.commits, actual.rollbacks, actual.closed]).toEqual([1, 3, 1]); expect(actual.parameters[9]).toEqual([overlay(metadata), messageId]);
  expect(actual.events.indexOf("commit")).toBeLessThan(actual.events.lastIndexOf("rollback")); expect(actual.events.slice(-2)).toEqual(["rollback", "close"]);
});
it.skipIf(!process.env.INK_DREAM_SOURCE)("preserves original invalid-object decoding and complete raw numeric categories in failure metadata", () => {
  for (const input of [metadata, "invalid", "[]", null]) {
    const actual = original([initial, failed, null, { metadata: input }, null]);
    expect(overlay(input)).toBe(actual.parameters[4][0]);
  }
  const raw = overlay(metadata); expect(raw).toContain('"integer":9007199254740993'); expect(raw).toContain('"float":1.0'); expect(raw).toContain('"negative":-0.0'); expect(raw).toContain('9007199254740995');
  expect(raw).toContain('"dispatchStatus":"failed"'); expect(raw).toContain(`"dispatchErrorCode":"${errorCode}"`); expect(raw).not.toContain("dispatchClaim");
});
