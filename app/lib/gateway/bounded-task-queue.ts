/**
 * A request-local sequential task queue with an explicit memory bound.
 *
 * Gateway response capture is secondary to delivering SSE data, so tasks run
 * asynchronously. Once the bound is reached, producers wait for one slot
 * before reading more upstream data. This preserves ordering without allowing
 * an unbounded chain of closures to retain streamed payloads in memory.
 */
export class BoundedTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  private readonly slotWaiters: Array<() => void> = [];

  constructor(
    private readonly capacity: number,
    private readonly onError: (error: unknown) => void | Promise<void>,
  ) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new RangeError("BoundedTaskQueue capacity must be a positive integer");
    }
  }

  async enqueue(task: () => void | Promise<void>) {
    if (this.pending >= this.capacity) {
      await new Promise<void>((resolve) => this.slotWaiters.push(resolve));
    }

    this.pending += 1;
    this.tail = this.tail
      .then(task)
      .catch(async (error) => {
        await Promise.resolve(this.onError(error)).catch(() => undefined);
      })
      .then(() => {
        this.pending -= 1;
        this.slotWaiters.shift()?.();
      });
  }

  async drain() {
    await this.tail;
  }
}
