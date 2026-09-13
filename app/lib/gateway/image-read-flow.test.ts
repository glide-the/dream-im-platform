// [Input] Synthetic PDF-page/image Read history and mocked auth, database, and Provider I/O.
// [Output] Public Messages -> estimate -> context -> reservation -> fragmented SSE -> usage regression.
// [Pos] Provider-free business-path contract; uses production handlers, estimator, prepare, and proxy.
// [Sync] 2026-09-13: reproduce multi-image history incorrectly rejected as context overflow.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleAnthropicCountTokens, handleAnthropicMessages } from "./anthropic-handler";
import { estimateJsonTokens } from "./request-body";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(), resolve: vi.fn(), begin: vi.fn(), send: vi.fn(),
  streaming: vi.fn(), known: vi.fn(), failure: vi.fn(), unknown: vi.fn(), capture: vi.fn(), count: vi.fn(),
}));
vi.mock("./auth", () => ({ authenticateGatewayRequest: mocks.authenticate }));
vi.mock("../models/resolver", () => ({ resolveBillableModel: mocks.resolve }));
vi.mock("./repository", () => ({ beginGatewayRequest: mocks.begin, markGatewayRequestStreaming: mocks.streaming }));
vi.mock("./provider-transport", async (original) => ({
  ...(await original<typeof import("./provider-transport")>()), sendProviderRequest: mocks.send,
}));
vi.mock("./provider-clients", async (original) => ({
  ...(await original<typeof import("./provider-clients")>()),
  createAnthropicProviderClient: () => ({ messages: { countTokens: mocks.count } }),
}));
vi.mock("./lifecycle", () => ({
  finalizeKnownUsage: mocks.known, finalizeProviderFailure: mocks.failure, finalizeUnknownUsage: mocks.unknown,
}));
vi.mock("./payloads", () => ({
  recordGatewayRequestPayload: mocks.capture, recordGatewayJsonResponse: mocks.capture,
  startGatewayResponsePayload: mocks.capture, recordGatewayResponseEvent: mocks.capture,
  completeGatewayStreamPayload: mocks.capture, markGatewayPayloadCaptureFailure: mocks.capture,
  safePayloadWrite: (operation: Promise<unknown>) => operation.catch(() => undefined),
}));

const model = { id: "model-test", code: "image-alias", upstreamModel: "upstream", displayName: "Image",
  contextWindow: 1_000_000, maxOutputTokens: 384_000, capabilities: {}, requestHeaders: {} };
const resolved = {
  model, provider: { id: "provider-test", code: "provider-test", protocol: "anthropic",
    baseUrl: "https://example.invalid", encryptedCredential: { ciphertext: "x", iv: "y", tag: "z" },
    timeoutMs: 1000, maxRetries: 0, config: {} }, pricingRuleId: "price-test",
  pricing: { inputPriceMicrousdPerMillion: 1, outputPriceMicrousdPerMillion: 1,
    cacheReadPriceMicrousdPerMillion: 1, cacheWritePriceMicrousdPerMillion: 1, markupBps: 0, discountBps: 0 }, limits: {},
};
const image = (length: number) => ({
  type: "image", source: { type: "base64", media_type: "image/png", data: "A".repeat(length) },
});
function request(messages: unknown[]) {
  return new Request("https://gateway.test/v1/messages?beta=true", { method: "POST",
    headers: { "content-type": "application/json", "x-ink-turn-idempotency-key": "synthetic-image-turn" },
    body: JSON.stringify({ model: "image-alias", max_tokens: 384_000, stream: true, messages }),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE", undefined);
  vi.stubEnv("GATEWAY_MAX_BODY_BYTES", undefined);
  mocks.authenticate.mockResolvedValue({ platformUserId: "actor-test" });
  mocks.resolve.mockResolvedValue(resolved);
  mocks.begin.mockResolvedValue({ kind: "reserved", requestId: "request-test" });
  mocks.streaming.mockResolvedValue(undefined);
  mocks.capture.mockResolvedValue(undefined);
  mocks.known.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("large image Read business path", () => {
  it("keeps native count_tokens authoritative and retains the cross-protocol local fallback", async () => {
    const messages = [{ role: "user", content: [image(575_652)] }];
    const countRequest = () => new Request("https://gateway.test/v1/messages/count_tokens", {
      method: "POST", body: JSON.stringify({ model: "image-alias", messages }),
    });
    mocks.count.mockResolvedValue({ input_tokens: 1234 });
    const native = await handleAnthropicCountTokens(countRequest());
    expect(await native.json()).toEqual({ input_tokens: 1234 });
    expect(mocks.count).toHaveBeenCalledWith(expect.objectContaining({ model: "upstream", messages }), expect.any(Object));
    mocks.resolve.mockResolvedValue({ ...resolved, provider: { ...resolved.provider, protocol: "openai" } });
    const fallback = await handleAnthropicCountTokens(countRequest());
    const counted = await fallback.json();
    expect(fallback.status).toBe(200);
    expect(counted.input_tokens).toBe(estimateJsonTokens({ messages }));
    expect(mocks.count).toHaveBeenCalledOnce();
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("preserves images and completes SSE with actual usage after multi-page history", async () => {
    const messages = [
      { role: "user", content: Array.from({ length: 10 }, () => image(240_000)) },
      { role: "assistant", content: [{ type: "tool_use", id: "read-1", name: "Read", input: { file_path: "files/fixture.png" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "read-1", content: [image(575_652), image(397_332)] }] },
    ];
    expect(estimateJsonTokens({ messages }) + model.maxOutputTokens).toBeGreaterThan(model.contextWindow);
    const parts = [
      'event: message_start\ndata: {"type":"message_start","message":{"id":"msg-test","model":"upstream","usage":{"input_tokens":12400,"output_tokens":0}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_',
      'delta","text":"image read complete"}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n',
    ];
    const abort = { signal: new AbortController().signal, abort: vi.fn(), cleanup: vi.fn(), refreshStreamIdleTimeout: vi.fn() };
    mocks.send.mockResolvedValue({ response: new Response(new ReadableStream({ start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part)); controller.close();
    } }), { headers: { "content-type": "text/event-stream" } }), abort });
    const response = await handleAnthropicMessages(request(messages));
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).toContain("image read complete");
    expect(text.match(/event: message_stop/g)).toHaveLength(1);
    expect(mocks.begin).toHaveBeenCalledWith(expect.objectContaining({ estimatedTokens: expect.any(Number) }));
    expect(mocks.begin.mock.calls[0][0].estimatedTokens).toBeLessThan(model.contextWindow);
    expect(mocks.send.mock.calls[0][0].body.messages).toEqual(messages);
    expect(mocks.known).toHaveBeenCalledWith(expect.objectContaining({
      usage: expect.objectContaining({ inputTokens: 12400, outputTokens: 9 }), outcome: "succeeded",
    }));
    expect(mocks.failure).not.toHaveBeenCalled();
    expect(abort.cleanup).toHaveBeenCalledOnce();
  });

  it("still rejects genuinely oversized text before reservation or Provider calls", async () => {
    const response = await handleAnthropicMessages(request([{ role: "user", content: "正文".repeat(400_000) }]));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "MODEL_CONTEXT_WINDOW_EXCEEDED" } });
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("uses the resolved cross-protocol Provider before estimating image tool-result text", async () => {
    mocks.resolve.mockResolvedValue({ ...resolved, provider: { ...resolved.provider, protocol: "openai" } });
    const messages = [{ role: "user", content: [{ type: "tool_result", tool_use_id: "read-1", content: [image(2_000_000)] }] }];
    const response = await handleAnthropicMessages(request(messages));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "MODEL_CONTEXT_WINDOW_EXCEEDED" } });
    expect(mocks.begin).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
