import { describe, expect, it } from "vitest";
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
});
