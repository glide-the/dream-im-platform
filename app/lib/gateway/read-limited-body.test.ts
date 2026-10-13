// [Input] Declared and chunked byte streams around an explicit limit.
// [Output] Deterministic bounded-read success and cancellation evidence.
// [Pos] Provider-free unit contract for Images request/response memory boundaries.
// [Sync] 2026-10-09: cover chunked overflow that cannot be rejected from Content-Length alone.

import { describe, expect, it, vi } from "vitest";

import { BodyLimitExceededError, readLimitedBody } from "./read-limited-body";

describe("readLimitedBody", () => {
  it("returns bytes at the exact limit", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3]));
        controller.close();
      },
    });
    await expect(readLimitedBody({ body, maxBytes: 3 })).resolves.toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("cancels an undeclared chunked body as soon as it exceeds the limit", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
      },
      cancel,
    });
    await expect(readLimitedBody({ body, maxBytes: 3 })).rejects.toBeInstanceOf(
      BodyLimitExceededError,
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});
