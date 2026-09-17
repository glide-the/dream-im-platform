// [Input] Original full Workflow models with explicit ASCII controls and Unicode whitespace source cases.
// [Output] Actual Pydantic acceptance and normalized non-date field parity for Run/Transition/Preflight.
// [Pos] Read-only production source oracle; date instants have independent exact-microsecond tests.
// [Sync] 2026-09-15: prove model normalization with the explicitly selected Dream oracle interpreter.
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
import { validWorkflowPreflightRow } from "../../../tests/fixtures/workflowPreflight";
import { workflowRunDto, workflowRunTransitionDto } from "./workflowRunDto";
import { workflowPreflightDto } from "./workflowPreflightDto";
import { projectWorkflowTimestamp } from "./workflowRunService";
const dateFields = new Set(["source_message_time", "created_at", "started_at", "completed_at", "occurred_at", "expires_at"]);
it.skipIf(!process.env.INK_DREAM_SOURCE)("matches actual Workflow model string normalization and control-character validation", () => {
  const raw = validWorkflowPreflightRow(); const preflight = { ...Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "consumed_at" && key !== "clock")), expires_at: projectWorkflowTimestamp(raw.expires_at), created_at: projectWorkflowTimestamp(raw.created_at), preflight_token: null };
  const transition = { transition_id: `wrt_${"f".repeat(32)}`, workflow_run_id: validWorkflowRun().workflow_run_id, transition_seq: 1, from_status: null, to_status: "preflight", actor_id: "1", reason_code: null, failed_step: null, error_code: null, occurred_at: validWorkflowRun().created_at };
  const cases: Array<{ model: "run" | "transition" | "preflight"; value: unknown }> = [];
  for (const whitespace of ["\u001c", "\u001d", "\u001e", "\u001f", "\u0085", "\u00a0", "\u1680", "\u2000", "\u2028", "\u202f", "\u205f", "\u3000", "\ufeff"]) {
    cases.push({ model: "run", value: { ...validWorkflowRun(), deck_plugin_id: `${whitespace} plugin ${whitespace}` } },
      { model: "preflight", value: { ...preflight, deck_plugin_id: `${whitespace} plugin ${whitespace}` } },
      { model: "transition", value: { ...transition, reason_code: `${whitespace} reason ${whitespace}` } });
  }
  cases.push({ model: "run", value: { ...validWorkflowRun(), workflow_run_id: `\u001c${validWorkflowRun().workflow_run_id}\u001c` } },
    { model: "preflight", value: { ...preflight, status: " passed " } });
  const oracle = spawnSync(process.env.INK_DREAM_ORACLE_PYTHON ?? "python3", [resolve(process.cwd(), "tests/integration/deckPluginMetadataOracle.py")], { input: JSON.stringify({ action: "workflow-model", cases }), env: process.env, encoding: "utf8", timeout: 10_000 });
  expect(oracle.status, "Original source oracle must launch").toBe(0);
  const results = JSON.parse(oracle.stdout) as Array<{ accepted: boolean; value?: unknown }>;
  expect(results.length).toBe(cases.length);
  const models = { run: workflowRunDto, transition: workflowRunTransitionDto, preflight: workflowPreflightDto };
  cases.forEach((item, index) => { const value = models[item.model].safeParse(item.value); expect(value.success, `Original acceptance ${index}`).toBe(results[index].accepted);
    if (value.success) expect(Object.fromEntries(Object.entries(value.data).filter(([key]) => !dateFields.has(key))), `Original model strings ${index}`).toEqual(results[index].value); });
});
