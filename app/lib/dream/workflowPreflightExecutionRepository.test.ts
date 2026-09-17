// [Input] Fixed server stages and scoped original requests through the production audit repository.
// [Output] Audit rows compatible with the existing four-column uniqueness boundary.
// [Pos] Provider-free repository regression; no database, index replacement or receipt mutation.
// [Sync] 2026-09-15: retain the first public binding failure as evidence for distinct stage keys.
import { describe, expect, it, vi } from "vitest";
import { adminAuditLogs } from "@ink-memory/db/schema";
import type { DataTransaction } from "./database";
import { WorkflowPreflightExecutionRepository, type PreflightRequestContext } from "./workflowPreflightExecutionRepository";

const context: PreflightRequestContext = { serviceClientId: "service", actor: "subject", canonicalUserId: "9007199254740993",
  requestId: "original", inputSha256: "a".repeat(64), input: { workspace_id: "workspace" } };
function capture(input = context) {
  const values = vi.fn<(row: typeof adminAuditLogs.$inferInsert) => Promise<void>>().mockResolvedValue(undefined);
  const insert = vi.fn().mockReturnValue({ values });
  const repository = new WorkflowPreflightExecutionRepository({ insert } as unknown as DataTransaction, input);
  return { repository, insert, values };
}
function uniqueKey(row: typeof adminAuditLogs.$inferInsert) {
  return JSON.stringify([row.request_id, row.action, row.resource_type, row.resource_id]);
}
describe("Preflight stage audit uniqueness", () => {
  it("persists every distinct stage under one original request and retains same-stage uniqueness", async () => {
    const { repository, insert, values } = capture();
    for (const stage of ["expire", "checking", "binding", "snapshot", "snapshot_binding"] as const) await repository.audit(stage);
    const rows = values.mock.calls.map(([row]) => row);
    expect(new Set(rows.map(uniqueKey)).size).toBe(5);
    for (const row of rows) {
      expect(row).toMatchObject({ request_id: context.requestId, action: "dream.workflow-preflight.stage", resource_type: "dream_operation" });
      expect(row.resource_id).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(insert.mock.calls.every(([table]) => table === adminAuditLogs)).toBe(true);
    await repository.audit("binding", { stage: "checking", input_sha256: "spoofed", reused: 1 });
    const repeated = values.mock.calls.at(-1)![0];
    expect(uniqueKey(repeated)).toBe(uniqueKey(rows[2]));
    expect(repeated.id).not.toBe(rows[2].id);
    expect(repeated.metadata).toEqual({ stage: "binding", input_sha256: context.inputSha256, reused: 1 });
  });
  it.each(["serviceClientId", "actor", "requestId"] as const)("separates stage keys for a different %s", async key => {
    const first = capture(), second = capture({ ...context, [key]: "other" });
    await first.repository.audit("binding"); await second.repository.audit("binding");
    expect(first.values.mock.calls[0][0].resource_id).not.toBe(second.values.mock.calls[0][0].resource_id);
  });
  it("rejects an unknown runtime stage before writing an audit", async () => {
    const { repository, insert } = capture();
    await expect(Reflect.apply(repository.audit, repository, ["request-selected-stage"])).rejects.toThrow();
    expect(insert).not.toHaveBeenCalled();
  });
});
