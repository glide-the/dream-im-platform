// [Input] Fragmented provider SSE bytes, cancellation signals, and network-activity callbacks.
// [Output] Regression proof for event framing, UTF-8, cancellation, and raw chunk activity observation.
// [Pos] Unit contract tests for the Gateway incremental SSE parser.
// [Sync] 2026-08-27: prove keepalive/data chunks refresh stream-idle policy even without a parsed event.

import { describe, expect, it, vi } from "vitest";
import { parseSseStream } from "./sse";

function fragmented(parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

describe("incremental SSE parser", () => {
  it("reassembles one event split across network chunks", async () => {
    const events = [];
    for await (const event of parseSseStream(fragmented(["event: content_block_", "delta\ndata: {\"type\":\"content_", "block_delta\"}\n\n"]))) events.push(event);
    expect(events).toEqual([{ event: "content_block_delta", data: '{"type":"content_block_delta"}', raw: 'event: content_block_delta\ndata: {"type":"content_block_delta"}' }]);
  });

  it("parses multiple events in one chunk and preserves a final event without a blank line", async () => {
    const events = [];
    for await (const event of parseSseStream(fragmented(['data: {"n":1}\n\ndata: {"n":2}\n\ndata: [DONE]']))) events.push(event.data);
    expect(events).toEqual(['{"n":1}', '{"n":2}', "[DONE]"]);
  });

  it("supports CRLF and multiline data", async () => {
    const events = [];
    for await (const event of parseSseStream(fragmented(["event: error\r\ndata: line1\r\ndata: line2\r\n\r\n"]))) events.push(event);
    expect(events[0]).toMatchObject({ event: "error", data: "line1\nline2" });
  });

  it("decodes UTF-8 characters split across byte chunks", async () => {
    const encoded = new TextEncoder().encode('data: {"text":"梦境"}\n\n');
    const splitAt = encoded.indexOf(0xe6) + 1;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded.slice(0, splitAt));
        controller.enqueue(encoded.slice(splitAt));
        controller.close();
      },
    });
    const events = [];
    for await (const event of parseSseStream(stream)) events.push(event.data);
    expect(events).toEqual(['{"text":"梦境"}']);
  });

  it("cancels a pending reader when the request signal aborts", async () => {
    const cancelled = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const controller = new AbortController();
    const reading = parseSseStream(stream, controller.signal).next();
    controller.abort(new DOMException("client disconnected", "AbortError"));
    await expect(reading).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("reports every non-empty network chunk including keepalive-only chunks", async () => {
    const activity = vi.fn();
    const events = [];
    for await (const event of parseSseStream(
      fragmented([": ping\n\n", "data: {\"ok\":", "true}\n\n"]),
      undefined,
      activity,
    )) events.push(event.data);
    expect(events).toEqual(['{"ok":true}']);
    expect(activity).toHaveBeenCalledTimes(3);
  });
});
