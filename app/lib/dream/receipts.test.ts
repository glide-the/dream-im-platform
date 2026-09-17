// [Input] Original committed service/actor/request/input receipts and independent entity scopes.
// [Output] Bounded replay or conflict without re-executing the mutation, including new exact Run scope.
// [Pos] Production receipt compatibility verification; atomic SQL effects remain public integration evidence.
// [Sync] 2026-09-15: preserve old Thread/Editor receipt JSON and deny mismatched Run recovery.
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReceiptRepository } from "./receipts";
import { canonicalContractJson } from "./operationRegistry";
import type { DataTransaction } from "./database";

const input = { workspace_id: "workspace", workflow_run_id: `run_${"a".repeat(32)}` };
const output = z.strictObject({ saved: z.literal(true) });
const prior = { inputSha256: createHash("sha256").update(canonicalContractJson(input)).digest("hex"), result: { saved: true }, threadScope: "thread", editorSessionScope: null, runScope: input.workflow_run_id };
describe("original receipt and exact Run scope", () => {
  it("recovers the committed Run result without a new action", async () => {
    const store = new ReceiptRepository({ execute: vi.fn() } as unknown as DataTransaction, "service", "actor");
    vi.spyOn(store, "find").mockResolvedValue(prior); const action = vi.fn();
    expect(await store.execute("workflow-run.cancel", "request", input, output, action, "thread", null, input.workflow_run_id)).toEqual({ saved: true });
    expect(action).not.toHaveBeenCalled();
  });
  it("rejects differing Run/Thread/input scopes before re-executing a committed request", async () => {
    const store = new ReceiptRepository({ execute: vi.fn() } as unknown as DataTransaction, "service", "actor");
    vi.spyOn(store, "find").mockResolvedValue(prior); const action = vi.fn();
    await expect(store.execute("workflow-run.cancel", "request", input, output, action, "thread", null, `run_${"b".repeat(32)}`)).rejects.toMatchObject({ code: "OPERATION_REQUEST_CONFLICT", status: 409 });
    await expect(store.execute("workflow-run.cancel", "request", input, output, action, "other", null, input.workflow_run_id)).rejects.toMatchObject({ status: 409 });
    await expect(store.execute("workflow-run.cancel", "request", { ...input, workspace_id: "other" }, output, action, "thread", null, input.workflow_run_id)).rejects.toMatchObject({ status: 409 });
    expect(action).not.toHaveBeenCalled();
  });
  it("reads original legacy Thread-only and Editor receipt JSON without rewriting it", async () => {
    let result: unknown = { schema_version: 1, data: { saved: true }, thread_scope: "thread" };
    const tx = { select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ inputSha256: prior.inputSha256, result }] }) }) }) } as unknown as DataTransaction;
    const store = new ReceiptRepository(tx, "service", "actor");
    expect(await store.find("chat-user-message.persist", "request")).toMatchObject({ result: { saved: true }, threadScope: "thread", editorSessionScope: null, runScope: null });
    result = { schema_version: 1, data: { saved: true }, thread_scope: "thread", editor_session_scope: "editor" };
    expect(await store.find("editor-state.replace", "request")).toMatchObject({ editorSessionScope: "editor", runScope: null });
  });
});
