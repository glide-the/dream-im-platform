// [Input] Passive observer faults and the real operation/queue instrumentation helpers.
// [Output] Success/failure identity, single invocation and balanced weighted queue evidence.
// [Pos] Provider-free observation contract; no database, service or account mutation.
import { afterEach, describe, expect, it, vi } from "vitest";
import { observeAuthenticatedActor, observeCapacityOperation } from "./capacity";
import { BoundedTaskQueue } from "../gateway/bounded-task-queue";

const root = globalThis as typeof globalThis & { __inkCapacityObserverV1?: Record<string, unknown> };
afterEach(() => { delete root.__inkCapacityObserverV1; });

describe("passive business observations", () => {
  it("preserves the original result and invokes a business operation exactly once when observation fails", async () => {
    root.__inkCapacityObserverV1 = { operation: () => { throw new Error("observer unavailable"); } };
    const operation = vi.fn(async () => ({ original: true }));
    const result = await observeCapacityOperation("settlement", operation);
    expect(result).toEqual({ original: true });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("preserves the exact business error when the observer also fails", async () => {
    const failure = new Error("original operation failed");
    root.__inkCapacityObserverV1 = { operation: () => { throw new Error("observer failed"); } };
    const operation = vi.fn(async () => { throw failure; });
    await expect(observeCapacityOperation("payload_write", operation)).rejects.toBe(failure);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(() => observeAuthenticatedActor("gateway", "synthetic-actor")).not.toThrow();
  });

  it("balances queue bytes and depth after failed tasks without changing task ordering", async () => {
    let events = 0, bytes = 0;
    root.__inkCapacityObserverV1 = { queueDelta: (count: number, size: number) => { events += count; bytes += size; } };
    let release: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const seen: number[] = [];
    const onError = vi.fn();
    const queue = new BoundedTaskQueue(2, onError);
    await queue.enqueue(async () => { await held; seen.push(1); }, 13);
    await queue.enqueue(async () => { seen.push(2); throw new Error("write failed"); }, 17);
    expect([events, bytes]).toEqual([2, 30]);
    release();
    await queue.drain();
    expect(seen).toEqual([1, 2]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect([events, bytes]).toEqual([0, 0]);
  });
});
