// [Input] Registry169 service with fixed Repository/receipt collaborators.
// [Output] Transition, replay, identity and delegation-boundary evidence.
// [Pos] Provider-free DTO-Service-ORM contract test; no database or Runtime.
// [Sync] 2026-09-16: validate the migrated auto-repair status machine.
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lock: vi.fn(), update: vi.fn(), execute: vi.fn() }));
vi.mock("./dreamAutoRepairRepository", () => ({
  DreamAutoRepairRepository: class {
    lockOwnedUserMessage = mocks.lock;
    updateMetadata = mocks.update;
  },
}));
vi.mock("./receipts", () => ({
  ReceiptRepository: class {
    execute = mocks.execute;
  },
}));

import { AuthBoundaryError } from "../auth/config";
import { runDreamAutoRepairOperation } from "./dreamAutoRepairService";

const identity = {
  kind: "story-workspace-dream-auto-repair" as const,
  schema_version: "story-workspace-dream-auto-repair/v1" as const,
  originating_message_id: "origin-message",
  originating_turn_id: "origin-turn",
  workflow_run_id: `run_${"a".repeat(32)}`,
  repair_attempt: 1 as const,
  validation_code: "DREAM_STAGE_SCHEMA_INVALID",
  idempotency_key: `dream-auto-repair/v1:${"b".repeat(64)}`,
  project_cleanup: null,
};
const input = { thread_id: "thread-1", message_id: "dream_repair_1", expected_identity: identity, status: "dispatched" as const };
const principal = { subject: "subject", canonical_user_id: "42", client_id: "dream", scopes: ["dream:write"], status: "active" as const };
const actor = { principal, threadScope: "thread-1", runScope: identity.workflow_run_id, editorSessionScope: null };
const metadata = (status: "dispatching" | "dispatched" | "failed", patch: Record<string, unknown> = {}) => JSON.stringify({
  kind: identity.kind,
  schemaVersion: identity.schema_version,
  originatingMessageId: identity.originating_message_id,
  originatingTurnId: identity.originating_turn_id,
  workflowRunId: identity.workflow_run_id,
  repairAttempt: identity.repair_attempt,
  validationCode: identity.validation_code,
  idempotencyKey: identity.idempotency_key,
  dispatch_status: status,
  ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute.mockImplementation(async (...args: unknown[]) => (args[4] as () => Promise<unknown>)());
  mocks.lock.mockResolvedValue({ id: input.message_id, thread_id: input.thread_id, role: "user", metadata: metadata("dispatching") });
  mocks.update.mockResolvedValue(true);
});

it("locks the owned message and commits dispatching to dispatched", async () => {
  expect(await runDreamAutoRepairOperation("dream-auto-repair.settle", input, actor,
    "dream-service", "original-request", { marker: "tx" } as never)).toEqual({
    message_id: input.message_id, status: "dispatched", changed: true,
  });
  expect(mocks.lock).toHaveBeenCalledExactlyOnceWith(input.thread_id, input.message_id);
  expect(JSON.parse(mocks.update.mock.calls[0][2])).toMatchObject({ dispatch_status: "dispatched", workflowRunId: identity.workflow_run_id });
  expect(mocks.execute.mock.calls[0].slice(0, 4)).toEqual([
    "dream-auto-repair.settle", "original-request", input, expect.anything(),
  ]);
  expect(mocks.execute.mock.calls[0].slice(5)).toEqual(["thread-1", null, identity.workflow_run_id]);
});

it.each(["dispatched", "failed"] as const)("returns an exact %s replay without another update", async status => {
  mocks.lock.mockResolvedValue({ id: input.message_id, thread_id: input.thread_id, role: "user", metadata: metadata(status) });
  const command = { ...input, status };
  expect(await runDreamAutoRepairOperation("dream-auto-repair.settle", command, actor,
    "dream-service", `request-${status}`, {} as never)).toEqual({ message_id: input.message_id, status, changed: false });
  expect(mocks.update).not.toHaveBeenCalled();
});

it("allows dispatched to failed and rejects failed to dispatched", async () => {
  mocks.lock.mockResolvedValue({ id: input.message_id, thread_id: input.thread_id, role: "user", metadata: metadata("dispatched") });
  expect((await runDreamAutoRepairOperation("dream-auto-repair.settle", { ...input, status: "failed" }, actor,
    "dream-service", "request-failed", {} as never)).changed).toBe(true);
  mocks.lock.mockResolvedValue({ id: input.message_id, thread_id: input.thread_id, role: "user", metadata: metadata("failed") });
  await expect(runDreamAutoRepairOperation("dream-auto-repair.settle", input, actor,
    "dream-service", "request-conflict", {} as never)).rejects.toMatchObject({ code: "DREAM_AUTO_REPAIR_MESSAGE_CONFLICT" });
});

it("rejects changed identity and Thread/Run authority before mutation", async () => {
  mocks.lock.mockResolvedValue({ id: input.message_id, thread_id: input.thread_id, role: "user", metadata: metadata("dispatching", { validationCode: "OTHER" }) });
  await expect(runDreamAutoRepairOperation("dream-auto-repair.settle", input, actor,
    "dream-service", "request-invalid", {} as never)).rejects.toMatchObject({ code: "DREAM_AUTO_REPAIR_MESSAGE_INVALID" });
  expect(mocks.update).not.toHaveBeenCalled();
  for (const changed of [
    { ...actor, threadScope: "thread-2" },
    { ...actor, runScope: `run_${"c".repeat(32)}` },
    { ...actor, editorSessionScope: "editor-1" },
  ]) {
    await expect(runDreamAutoRepairOperation("dream-auto-repair.settle", input, changed,
      "dream-service", "request-denied", {} as never)).rejects.toBeInstanceOf(AuthBoundaryError);
  }
  expect(mocks.lock).toHaveBeenCalledTimes(1);
});
