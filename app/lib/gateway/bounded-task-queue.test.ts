import { describe, expect, it, vi } from "vitest";
import { BoundedTaskQueue } from "./bounded-task-queue";

describe("BoundedTaskQueue", () => {
  it("keeps tasks ordered and applies capacity backpressure", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const events: string[] = [];
    const queue = new BoundedTaskQueue(1, vi.fn());

    await queue.enqueue(async () => {
      events.push("first-start");
      await firstBlocked;
      events.push("first-end");
    });
    let secondScheduled = false;
    const second = queue.enqueue(() => { events.push("second"); }).then(() => { secondScheduled = true; });

    await Promise.resolve();
    expect(secondScheduled).toBe(false);
    expect(events).toEqual(["first-start"]);
    releaseFirst?.();
    await second;
    await queue.drain();
    expect(events).toEqual(["first-start", "first-end", "second"]);
  });

  it("reports a failed task and continues draining later tasks", async () => {
    const onError = vi.fn();
    const queue = new BoundedTaskQueue(2, onError);
    const completed = vi.fn();
    await queue.enqueue(() => { throw new Error("capture failed"); });
    await queue.enqueue(completed);
    await queue.drain();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "capture failed" }));
    expect(completed).toHaveBeenCalledOnce();
  });
});
