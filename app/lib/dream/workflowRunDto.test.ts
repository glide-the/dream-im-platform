// [Input] Original Workflow Run/Transition states, source combinations and exact lifecycle instants.
// [Output] Strict production DTO success/failure evidence, including one-microsecond ordering.
// [Pos] Provider-free Workflow lifecycle contract verification; no database or alternate state machine.
// [Sync] 2026-09-15: distinguish original Pydantic string whitespace from explicit Python business strip.
import { describe, expect, it } from "vitest";
import { workflowRunDto, workflowRunLookupInputDto, workflowRunTransitionDto, workflowTimestampMicros } from "./workflowRunDto";

import { validWorkflowRun } from "../../../tests/fixtures/workflowRun";
const runId = validWorkflowRun().workflow_run_id;
const session = `as_${"b".repeat(32)}`;
describe("full original Workflow Run lifecycle", () => {
  it.each(["preflight", "queued", "running", "output_validating", "pending_review", "confirmed", "rejected", "completed", "failed", "cancelled"])("preserves %s with its original bindings and terminal rules", status => {
    const run = { ...validWorkflowRun(), status };
    if (["running", "output_validating", "pending_review", "confirmed", "rejected", "completed"].includes(status)) Object.assign(run, { runtime_load_receipt_id: "receipt", agent_session_id: session, started_at: "2026-09-14T00:00:00.123457+00:00" });
    if (["rejected", "completed", "failed", "cancelled"].includes(status)) run.completed_at = "2026-09-14T00:00:00.123458+00:00";
    if (status === "failed") Object.assign(run, { failed_step: "", error_code: "" });
    expect(workflowRunDto.safeParse(run).success).toBe(true);
  });
  it("requires joint Session/receipt and status-specific start bindings", () => {
    const run = validWorkflowRun();
    for (const fields of [{ runtime_load_receipt_id: "receipt" }, { agent_session_id: session }, { status: "running" }, { runtime_load_receipt_id: "receipt", agent_session_id: session }]) expect(workflowRunDto.safeParse({ ...run, ...fields }).success).toBe(false);
    expect(workflowRunDto.safeParse({ ...run, status: "failed", failed_step: "step", error_code: "code", runtime_load_receipt_id: "", agent_session_id: session, completed_at: run.created_at }).success).toBe(true);
  });
  it("retains optional source Thread alone or a complete source message tuple", () => {
    const run = validWorkflowRun();
    expect(workflowRunDto.safeParse({ ...run, source_voice_thread_id: "" }).success).toBe(true);
    expect(workflowRunDto.safeParse({ ...run, source_voice_thread_id: "thread", source_message_id: "message", source_message_time: run.created_at }).success).toBe(true);
    for (const source of [{ source_message_id: "message" }, { source_message_time: run.created_at }, { source_voice_thread_id: "thread", source_message_id: "message" }, { source_message_id: "message", source_message_time: run.created_at }, { source_voice_thread_id: "thread", source_message_id: "message", source_message_time: "2026-09-14T00:00:00.123456" }]) expect(workflowRunDto.safeParse({ ...run, ...source }).success).toBe(false);
    expect(workflowRunDto.safeParse({ ...run, status: "running", runtime_load_receipt_id: "receipt", agent_session_id: session, source_voice_thread_id: session }).success).toBe(false);
  });
  it("compares microseconds across offsets without JS Date truncation", () => {
    const run = validWorkflowRun();
    expect(workflowTimestampMicros("2026-09-14T08:00:00.123456+08:00")).toBe(workflowTimestampMicros(run.created_at));
    expect(workflowTimestampMicros("1969-12-31T23:59:59.999999Z")).toBe(-1n);
    expect(workflowRunDto.safeParse({ ...run, started_at: "2026-09-14T08:00:00.123455+08:00" }).success).toBe(false);
    expect(workflowRunDto.safeParse({ ...run, status: "cancelled", started_at: "2026-09-14T00:00:00.123458Z", completed_at: "2026-09-14T00:00:00.123457Z" }).success).toBe(false);
    expect(workflowRunDto.safeParse({ ...run, status: "cancelled", completed_at: "2026-09-14T00:00:00.123455Z" }).success).toBe(false);
  });
  it("rejects incomplete failure/completion facts and invalid timestamps without throwing from safeParse", () => {
    const run = validWorkflowRun();
    for (const fields of [{ status: "failed", completed_at: run.created_at }, { failed_step: "step" }, { status: "cancelled" }, { completed_at: run.created_at }, { created_at: "infinity" }, { created_at: "2026-02-30T00:00:00Z" }, { started_at: "not-time" }, { completed_at: "2026-09-14T00:00:00.1234567Z" }]) expect(workflowRunDto.safeParse({ ...run, ...fields }).success).toBe(false);
  });
  it("uses original model whitespace and preserves control characters and unbounded business IDs", () => {
    const run = workflowRunDto.parse({ ...validWorkflowRun(), deck_plugin_id: "\u0085 plugin \u3000", workspace_id: "w".repeat(1024) });
    expect(run.deck_plugin_id).toBe("plugin"); expect(run.workspace_id.length).toBe(1024);
    expect(workflowRunDto.parse({ ...run, deck_plugin_id: "\u001c plugin \u001c" }).deck_plugin_id).toBe("\u001c plugin \u001c");
    expect(workflowRunDto.safeParse({ ...run, idempotency_key: "k".repeat(256) }).success).toBe(false);
    for (const key of ["actor_id", "user_id", "table", "status", "thread_id"]) expect(workflowRunLookupInputDto.safeParse({ workspace_id: "workspace", workflow_run_id: runId, [key]: "selector" }).success).toBe(false);
  });
});
describe("original stored Workflow transition model", () => {
  const transition = { transition_id: `wrt_${"e".repeat(32)}`, workflow_run_id: runId, transition_seq: 1, from_status: null, to_status: "preflight", actor_id: "9007199254740993", reason_code: null, failed_step: null, error_code: null, occurred_at: validWorkflowRun().created_at };
  it("accepts the sole initial NULL-to-preflight transition", () => {
    expect(workflowRunTransitionDto.safeParse(transition).success).toBe(true);
    expect(workflowRunTransitionDto.safeParse({ ...transition, transition_seq: 2 }).success).toBe(false);
    expect(workflowRunTransitionDto.safeParse({ ...transition, to_status: "queued" }).success).toBe(false);
  });
  it("checks actual changes and failure details without inventing a history edge validator", () => {
    expect(workflowRunTransitionDto.safeParse({ ...transition, from_status: "queued", to_status: "queued" }).success).toBe(false);
    expect(workflowRunTransitionDto.safeParse({ ...transition, from_status: "queued", to_status: "failed", failed_step: "", error_code: "" }).success).toBe(true);
    expect(workflowRunTransitionDto.safeParse({ ...transition, from_status: "queued", to_status: "failed" }).success).toBe(false);
    expect(workflowRunTransitionDto.safeParse({ ...transition, from_status: "completed", to_status: "preflight" }).success).toBe(true);
  });
});
