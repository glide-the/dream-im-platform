// [Input] Persisted per-task event high-water mark and the next caller sequence.
// [Output] Gap-free append acceptance plus hole/rollback-safe conflict evidence.
// [Pos] Pure Repository sequencing guard used after the background service locks its task row.
// [Sync] 2026-09-15: reject stale, duplicate-new and skipped event sequence values before INSERT.
import { expect, it, vi } from "vitest";
import { ReflectionTaskRepository, requireNextReflectionEventSequence } from "./reflectionTaskRepository";
import type { DataTransaction } from "./database";

it.each([[0, 1], [7, 8], [2_147_483_646, 2_147_483_647]] as const)("accepts persisted max %s followed by %s", (current, requested) => {
  expect(() => requireNextReflectionEventSequence(current, requested)).not.toThrow();
});

it.each([[0, 2], [7, 7], [7, 9], [-1, 0], [2_147_483_647, 2_147_483_648], [1, Number.MAX_SAFE_INTEGER]] as const)("rejects a hole or stale sequence %s -> %s before INSERT", (current, requested) => {
  expect(() => requireNextReflectionEventSequence(current, requested)).toThrow("REFLECTION_EVENT_SEQUENCE_CONFLICT");
});

function transaction(selectResults: unknown[][]) {
  const insert = vi.fn(), select = vi.fn(() => {
    const result = selectResults.shift() ?? [];
    const query = { from: vi.fn(), where: vi.fn() };
    query.from.mockReturnValue(query); query.where.mockResolvedValue(result);
    return query;
  });
  const tx = {
    select,
    insert,
  };
  return { tx: tx as unknown as DataTransaction, insert, select };
}
const taskId = "11111111-1111-4111-8111-111111111111";
function event(sequence: number) { return { event_id: `evt_${taskId.replaceAll("-", "")}_${String(sequence).padStart(6, "0")}`, task_id: taskId, sequence, event_type: "reflection.context.ready", payload_json: `{\"sequence\":${sequence}}`, created_at: `2026-09-15T00:00:0${sequence}Z` }; }

it("uses the historical max and leaves the transaction unchanged when a caller skips a sequence", async () => {
  const fake = transaction([[], [{ sequence: 7 }]]), repository = new ReflectionTaskRepository(fake.tx);
  await expect(repository.appendEvent(event(9))).rejects.toMatchObject({ code: "REFLECTION_EVENT_SEQUENCE_CONFLICT", status: 409 });
  expect(fake.insert).not.toHaveBeenCalled();
});

it("replays one completely identical stored event without consulting max or inserting", async () => {
  const value = event(8), fake = transaction([[{ id: value.event_id, taskId, sequence: 8, type: value.event_type, payload: value.payload_json, createdAtMatches: true }]]), repository = new ReflectionTaskRepository(fake.tx);
  await expect(repository.appendEvent(value)).resolves.toBe(value.event_id);
  expect(fake.insert).not.toHaveBeenCalled();
  expect(fake.select).toHaveBeenCalledTimes(1);
});
