// [Input] Explicit sampler budget and read-only query outcomes through the actual deployment adapter.
// [Output] Stale-data visibility, nonoverlap and owned timer/pool cleanup evidence.
// [Pos] Provider-free metric sampler contract; no normal database access.
import { afterEach, expect, it, vi } from "vitest";
import adapter from "../../../deploy/observability/capacity-observer.cjs";

afterEach(() => vi.useRealTimers());

it("retains the last successful backlog with a failed-sample flag and stops its own timer and pool", async () => {
  vi.useFakeTimers();
  const callbacks = new Set<(result: unknown) => void>();
  const meter = {
    createObservableGauge: (name: string) => ({ name }),
    createCounter: () => ({ add: vi.fn() }),
    addBatchObservableCallback: (callback: (result: unknown) => void) => callbacks.add(callback),
    removeBatchObservableCallback: (callback: (result: unknown) => void) => callbacks.delete(callback),
  };
  const query = vi.fn().mockResolvedValueOnce({ rows: [{ count: 3, oldest: 90 }] }).mockRejectedValue(new Error("private connection details"));
  const end = vi.fn().mockResolvedValue(undefined);
  const stop = adapter.startBacklogSampler({ meter, policy: { backlogIntervalMs: 100 }, now: () => 100_000, createPool: () => ({ query, end }) });
  try {
    await vi.advanceTimersByTimeAsync(200);
    const metrics: Record<string, number> = {};
    for (const callback of callbacks) callback({ observe: (instrument: { name: string }, value: number) => { metrics[instrument.name] = value; } });
    expect(query).toHaveBeenCalledTimes(2);
    expect(metrics.ink_gateway_unsettled_requests).toBe(3);
    expect(metrics.ink_gateway_oldest_unsettled_age_seconds).toBe(10);
    expect(metrics.ink_gateway_backlog_sample_success).toBe(0);
    expect(metrics.ink_gateway_backlog_last_success_timestamp_seconds).toBe(100);
  } finally { await stop(); }
  await vi.advanceTimersByTimeAsync(1_000);
  expect(query).toHaveBeenCalledTimes(2);
  expect(end).toHaveBeenCalledTimes(1);
  expect(callbacks.size).toBe(0);
});
