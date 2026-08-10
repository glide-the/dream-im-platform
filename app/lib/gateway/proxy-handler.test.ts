import { beforeEach, describe, expect, it, vi } from "vitest";
import { GatewayError } from "./errors";
import { ProviderHttpError } from "./provider-transport";
import { proxyNonStreaming, proxyStreaming } from "./proxy-handler";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  markStreaming: vi.fn(),
  finalizeKnown: vi.fn(),
  finalizeFailure: vi.fn(),
  finalizeUnknown: vi.fn(),
  startPayload: vi.fn(),
  eventPayload: vi.fn(),
  completePayload: vi.fn(),
  jsonPayload: vi.fn(),
  markPayloadFailure: vi.fn(),
}));

vi.mock("./provider-transport", async (importOriginal) => ({ ...(await importOriginal<typeof import("./provider-transport")>()), sendProviderRequest: mocks.send }));
vi.mock("./repository", () => ({ markGatewayRequestStreaming: mocks.markStreaming }));
vi.mock("./lifecycle", () => ({ finalizeKnownUsage: mocks.finalizeKnown, finalizeProviderFailure: mocks.finalizeFailure, finalizeUnknownUsage: mocks.finalizeUnknown }));
vi.mock("./payloads", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./payloads")>()),
  startGatewayResponsePayload: mocks.startPayload,
  recordGatewayResponseEvent: mocks.eventPayload,
  completeGatewayStreamPayload: mocks.completePayload,
  recordGatewayJsonResponse: mocks.jsonPayload,
  markGatewayPayloadCaptureFailure: mocks.markPayloadFailure,
  safePayloadWrite: (promise: Promise<unknown>) => promise.catch(() => undefined),
}));

function sse(parts: string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({ start(controller) { for (const part of parts) controller.enqueue(encoder.encode(part)); controller.close(); } });
}

function prepared(providerProtocol: "anthropic" | "openai") {
  return {
    requestId: `req_${providerProtocol}`,
    effectiveMaxOutputTokens: 128,
    resolved: {
      provider: { protocol: providerProtocol, id: "p", code: "p", baseUrl: "https://example.com", encryptedCredential: { ciphertext: "x", iv: "y", tag: "z" }, timeoutMs: 1000, maxRetries: 0, config: {} },
      model: { id: "m", code: "m", upstreamModel: "upstream", displayName: "M", capabilities: {}, requestHeaders: {} },
      pricingRuleId: "price",
      pricing: { inputPriceMicrousdPerMillion: 1, outputPriceMicrousdPerMillion: 1, cacheReadPriceMicrousdPerMillion: 1, cacheWritePriceMicrousdPerMillion: 1, markupBps: 0, discountBps: 0 },
      limits: {},
    },
  };
}

function transport(response: Response) {
  const controller = new AbortController();
  return { response, abort: { signal: controller.signal, abort: vi.fn(() => controller.abort()), cleanup: vi.fn() } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.markStreaming.mockResolvedValue(undefined);
  mocks.finalizeKnown.mockResolvedValue({});
  mocks.finalizeFailure.mockResolvedValue(new GatewayError("UPSTREAM_ERROR", "failed", 502, "upstream_error"));
  mocks.finalizeUnknown.mockResolvedValue(undefined);
  mocks.startPayload.mockResolvedValue(undefined);
  mocks.eventPayload.mockResolvedValue(undefined);
  mocks.completePayload.mockResolvedValue(undefined);
  mocks.jsonPayload.mockResolvedValue(undefined);
  mocks.markPayloadFailure.mockResolvedValue(undefined);
});

describe("true gateway streaming proxy", () => {
  it("passes fragmented Anthropic SSE incrementally and settles final usage", async () => {
    mocks.send.mockResolvedValue(transport(new Response(sse([
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","model":"claude","usage":{"input_tokens":7,"output_tokens":0}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_',
      'delta","text":"hi"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
    ]), { headers: { "content-type": "text/event-stream" } })));
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/messages"), externalProtocol: "anthropic", prepared: prepared("anthropic"), body: { model: "alias", messages: [], max_tokens: 128, stream: true } });
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");
    expect(body.indexOf("message_start")).toBeLessThan(body.indexOf("content_block_delta"));
    expect(body).toContain("event: message_stop");
    expect(mocks.finalizeKnown).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 7, outputTokens: 2 }) }));
    expect(mocks.eventPayload).toHaveBeenCalledTimes(4);
  });

  it("emits OpenAI chunks and exactly one DONE terminator", async () => {
    mocks.send.mockImplementation(async ({ body }: { body: Record<string, unknown> }) => {
      expect(body).toMatchObject({ stream: true, stream_options: { include_usage: true } });
      return transport(new Response(sse([
        'data: {"id":"chat_1","object":"chat.completion.chunk","created":1,"model":"gpt","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
        'data: {"id":"chat_1","object":"chat.completion.chunk","created":1,"model":"gpt","choices":[],"usage":{"prompt_tokens":8,"completion_tokens":3,"total_tokens":11}}\n\ndata: [DONE]\n\n',
      ]), { headers: { "content-type": "text/event-stream; charset=utf-8" } }));
    });
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/chat/completions"), externalProtocol: "openai", prepared: prepared("openai"), body: { model: "alias", messages: [], stream: true } });
    const body = await response.text();
    expect(body.match(/data: \[DONE\]/g)).toHaveLength(1);
    expect(body).not.toContain("event: message_start");
    expect(mocks.finalizeKnown).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 8, outputTokens: 3 }) }));
  });

  it("maps an upstream error before SSE starts to a non-200 response", async () => {
    mocks.send.mockRejectedValue(new ProviderHttpError(401, { error: { message: "bad key" } }, "up_req"));
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/chat/completions"), externalProtocol: "openai", prepared: prepared("openai"), body: { model: "alias", messages: [], stream: true } });
    expect(response.status).toBe(502);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ error: { code: "UPSTREAM_ERROR" } });
  });

  it("propagates downstream cancellation to the upstream controller", async () => {
    const upstreamCancelled = vi.fn();
    const result = transport(new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"id":"chat_1","model":"gpt","choices":[{"delta":{"content":"hi"}}]}\n\n')); },
      cancel: upstreamCancelled,
    }), { headers: { "content-type": "text/event-stream" } }));
    mocks.send.mockResolvedValue(result);
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/chat/completions"), externalProtocol: "openai", prepared: prepared("openai"), body: { model: "alias", messages: [], stream: true } });
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(result.abort.abort).toHaveBeenCalledOnce();
    expect(upstreamCancelled).toHaveBeenCalledOnce();
    expect(mocks.completePayload).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
  });

  it("flushes the first valid upstream event before the upstream stream closes", async () => {
    let upstreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    mocks.send.mockResolvedValue(transport(new Response(new ReadableStream<Uint8Array>({
      start(controller) { upstreamController = controller; },
    }), { headers: { "content-type": "text/event-stream" } })));
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/messages"), externalProtocol: "anthropic", prepared: prepared("anthropic"), body: { model: "alias", messages: [], max_tokens: 32, stream: true } });
    const reader = response.body!.getReader();
    const firstRead = reader.read();
    upstreamController!.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_incremental","model":"claude","usage":{"input_tokens":3,"output_tokens":0}}}\n\n'));
    const first = await Promise.race([
      firstRead,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("first event was buffered")), 100)),
    ]);
    expect(new TextDecoder().decode(first.value)).toContain("message_start");
    upstreamController!.enqueue(new TextEncoder().encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'));
    upstreamController!.close();
    while (!(await reader.read()).done) { /* drain */ }
  });

  it("does not wait for response capture persistence before flushing the first event", async () => {
    let releaseCapture: (() => void) | undefined;
    mocks.startPayload.mockImplementationOnce(() => new Promise<void>((resolve) => { releaseCapture = resolve; }));
    let upstreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    mocks.send.mockResolvedValue(transport(new Response(new ReadableStream<Uint8Array>({
      start(controller) { upstreamController = controller; },
    }), { headers: { "content-type": "text/event-stream" } })));
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/messages"), externalProtocol: "anthropic", prepared: prepared("anthropic"), body: { model: "alias", messages: [], max_tokens: 32, stream: true } });
    const reader = response.body!.getReader();
    const firstRead = reader.read();
    upstreamController!.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_capture_pending","model":"claude","usage":{"input_tokens":2,"output_tokens":0}}}\n\n'));
    const first = await Promise.race([
      firstRead,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("capture persistence blocked first event")), 100)),
    ]);
    expect(new TextDecoder().decode(first.value)).toContain("msg_capture_pending");
    releaseCapture?.();
    upstreamController!.enqueue(new TextEncoder().encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'));
    upstreamController!.close();
    while (!(await reader.read()).done) { /* drain */ }
  });

  it("keeps two concurrent request streams isolated", async () => {
    const controllers = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
    mocks.send.mockImplementation(async ({ body }: { body: Record<string, unknown> }) => {
      const marker = String((body.messages as Array<{ content?: string }>)[0]?.content);
      return transport(new Response(new ReadableStream<Uint8Array>({
        start(controller) { controllers.set(marker, controller); },
      }), { headers: { "content-type": "text/event-stream" } }));
    });
    const requestA = proxyStreaming({ request: new Request("http://gateway/v1/messages"), externalProtocol: "anthropic", prepared: { ...prepared("anthropic"), requestId: "req_a" }, body: { model: "alias", messages: [{ role: "user", content: "A" }], max_tokens: 32, stream: true } });
    const requestB = proxyStreaming({ request: new Request("http://gateway/v1/messages"), externalProtocol: "anthropic", prepared: { ...prepared("anthropic"), requestId: "req_b" }, body: { model: "alias", messages: [{ role: "user", content: "B" }], max_tokens: 32, stream: true } });
    const [responseA, responseB] = await Promise.all([requestA, requestB]);
    const readerA = responseA.body!.getReader();
    const readerB = responseB.body!.getReader();
    const firstA = readerA.read();
    const firstB = readerB.read();
    controllers.get("A")!.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_A","model":"claude","usage":{"input_tokens":1,"output_tokens":0}}}\n\n'));
    controllers.get("B")!.enqueue(new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_B","model":"claude","usage":{"input_tokens":1,"output_tokens":0}}}\n\n'));
    const [chunkA, chunkB] = await Promise.all([firstA, firstB]);
    const textA = new TextDecoder().decode(chunkA.value);
    const textB = new TextDecoder().decode(chunkB.value);
    expect(textA).toContain("msg_A");
    expect(textA).not.toContain("msg_B");
    expect(textB).toContain("msg_B");
    expect(textB).not.toContain("msg_A");
    for (const marker of ["A", "B"]) {
      controllers.get(marker)!.enqueue(new TextEncoder().encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'));
      controllers.get(marker)!.close();
    }
    await Promise.all([
      (async () => { while (!(await readerA.read()).done) { /* drain */ } })(),
      (async () => { while (!(await readerB.read()).done) { /* drain */ } })(),
    ]);
  });

  it("cancels the upstream reader after an OpenAI DONE terminator", async () => {
    const cancelled = vi.fn();
    mocks.send.mockResolvedValue(transport(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"id":"chat_done","model":"gpt","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\ndata: [DONE]\n\n'));
      },
      cancel: cancelled,
    }), { headers: { "content-type": "text/event-stream" } })));
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/chat/completions"), externalProtocol: "openai", prepared: prepared("openai"), body: { model: "alias", messages: [], stream: true } });
    expect(await response.text()).toContain("data: [DONE]");
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("fails an otherwise complete stream when reliable final usage is missing", async () => {
    mocks.send.mockResolvedValue(transport(new Response(sse([
      'data: {"id":"chat_missing_usage","model":"gpt","choices":[{"index":0,"delta":{"content":"partial"},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n',
    ]), { headers: { "content-type": "text/event-stream" } })));
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/chat/completions"), externalProtocol: "openai", prepared: prepared("openai"), body: { model: "alias", messages: [], stream: true } });
    const body = await response.text();
    expect(mocks.finalizeUnknown).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", errorCode: "UPSTREAM_USAGE_MISSING" }));
    expect(mocks.finalizeKnown).not.toHaveBeenCalled();
    expect(body).toContain("UPSTREAM_USAGE_MISSING");
    expect(mocks.completePayload).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("keeps the client stream healthy when event persistence fails", async () => {
    mocks.eventPayload.mockRejectedValueOnce(new Error("database unavailable"));
    mocks.send.mockResolvedValue(transport(new Response(sse([
      'data: {"id":"chat_capture_failure","model":"gpt","choices":[{"index":0,"delta":{"content":"ok"},"finish_reason":null}]}\n\n',
      'data: {"id":"chat_capture_failure","model":"gpt","choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}\n\ndata: [DONE]\n\n',
    ]), { headers: { "content-type": "text/event-stream" } })));
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/chat/completions"), externalProtocol: "openai", prepared: prepared("openai"), body: { model: "alias", messages: [], stream: true } });
    const body = await response.text();
    expect(body).toContain('"content":"ok"');
    expect(body).toContain("data: [DONE]");
    expect(mocks.markPayloadFailure).toHaveBeenCalled();
    expect(mocks.completePayload).toHaveBeenCalledWith(expect.objectContaining({ captureError: expect.any(String) }));
  });

  it("emits a protocol error and records interruption when upstream fails after streaming starts", async () => {
    const encoder = new TextEncoder();
    let upstreamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    mocks.send.mockResolvedValue(transport(new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        upstreamController = controller;
        controller.enqueue(encoder.encode('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_interrupted","model":"claude","usage":{"input_tokens":2,"output_tokens":0}}}\n\nevent: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}\n\n'));
      },
    }), { headers: { "content-type": "text/event-stream" } })));
    const response = await proxyStreaming({ request: new Request("http://gateway/v1/messages"), externalProtocol: "anthropic", prepared: prepared("anthropic"), body: { model: "alias", messages: [], max_tokens: 32, stream: true } });
    const reader = response.body!.getReader();
    const chunks = [await reader.read(), await reader.read()];
    upstreamController!.error(new Error("socket reset"));
    while (true) {
      const chunk = await reader.read();
      chunks.push(chunk);
      if (chunk.done) break;
    }
    const body = chunks.map((chunk) => chunk.value ? new TextDecoder().decode(chunk.value) : "").join("");
    expect(body).toContain("partial");
    expect(body).toContain("event: error");
    expect(mocks.finalizeFailure).toHaveBeenCalled();
    expect(mocks.completePayload).toHaveBeenCalledWith(expect.objectContaining({ status: "interrupted" }));
  });
});

describe("gateway non-streaming protocol matrix", () => {
  it("returns a native Anthropic response without protocol pollution", async () => {
    mocks.send.mockResolvedValue(transport(new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 4, output_tokens: 2 } }), { headers: { "content-type": "application/json" } })));
    const response = await proxyNonStreaming({ request: new Request("http://gateway/v1/messages"), externalProtocol: "anthropic", prepared: prepared("anthropic"), body: { model: "alias", messages: [], max_tokens: 32 } });
    expect(await response.json()).toMatchObject({ type: "message", id: "msg_1" });
    expect(mocks.finalizeKnown).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 4, outputTokens: 2 }) }));
  });

  it("converts an Anthropic response to an OpenAI completion", async () => {
    mocks.send.mockResolvedValue(transport(new Response(JSON.stringify({ id: "msg_2", type: "message", role: "assistant", model: "claude", content: [{ type: "text", text: "converted" }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 3, cache_read_input_tokens: 2 } }), { headers: { "content-type": "application/json" } })));
    const response = await proxyNonStreaming({ request: new Request("http://gateway/v1/chat/completions"), externalProtocol: "openai", prepared: prepared("anthropic"), body: { model: "alias", messages: [], max_completion_tokens: 32 } });
    expect(await response.json()).toMatchObject({ object: "chat.completion", choices: [{ message: { content: "converted" }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
  });
});
