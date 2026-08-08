import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleAnthropicMessages } from "./anthropic-handler";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  create: vi.fn(),
  stream: vi.fn(),
  finalizeKnown: vi.fn(),
  finalizeProviderFailure: vi.fn(),
  finalizeUnknown: vi.fn(),
  markStreaming: vi.fn(),
}));

vi.mock("./prepare", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./prepare")>()),
  prepareGatewayRequest: mocks.prepare,
}));

vi.mock("./provider-clients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./provider-clients")>()),
  createAnthropicProviderClient: () => ({
    messages: { create: mocks.create, stream: mocks.stream },
  }),
}));

vi.mock("./lifecycle", () => ({
  finalizeKnownUsage: mocks.finalizeKnown,
  finalizeProviderFailure: mocks.finalizeProviderFailure,
  finalizeUnknownUsage: mocks.finalizeUnknown,
}));

vi.mock("./repository", () => ({
  markGatewayRequestStreaming: mocks.markStreaming,
}));

const ready = {
  kind: "ready" as const,
  value: {
    principal: {
      apiKeyId: "key_1",
      platformUserId: "usr_1",
      source: "ink-dream",
      externalUserId: "42",
      tier: "pro",
      scopes: ["messages:create"],
    },
    requestId: "req_test",
    effectiveMaxOutputTokens: 512,
    estimatedTokens: 600,
    resolved: {
      model: {
        id: "model_1",
        code: "claude-writing",
        upstreamModel: "claude-sonnet-upstream",
        displayName: "Claude Writing",
        capabilities: {},
      },
      provider: {
        id: "provider_1",
        code: "anthropic-primary",
        protocol: "anthropic" as const,
        baseUrl: "https://api.anthropic.com",
        encryptedCredential: { ciphertext: "x", iv: "y", tag: "z" },
        timeoutMs: 10_000,
        maxRetries: 0,
        config: {},
      },
      pricingRuleId: "price_1",
      pricing: {
        inputPriceMicrousdPerMillion: 3_000_000,
        outputPriceMicrousdPerMillion: 15_000_000,
        cacheReadPriceMicrousdPerMillion: 300_000,
        cacheWritePriceMicrousdPerMillion: 3_750_000,
        markupBps: 0,
        discountBps: 0,
      },
      limits: {},
    },
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue(ready);
  mocks.finalizeKnown.mockResolvedValue({});
  mocks.markStreaming.mockResolvedValue(undefined);
});

describe("Anthropic gateway handler", () => {
  it("proxies a non-streaming message and settles its usage", async () => {
    mocks.create.mockResolvedValue({
      id: "msg_upstream",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "ok", citations: null }],
      model: "claude-sonnet-upstream",
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 0,
      },
    });

    const response = await handleAnthropicMessages(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: "claude-writing",
          max_tokens: 10_000,
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req_test");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "claude-sonnet-upstream",
        max_tokens: 512,
        stream: false,
      }),
      expect.any(Object),
    );
    expect(mocks.finalizeKnown).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_test",
        outcome: "succeeded",
        usage: expect.objectContaining({ inputTokens: 100, outputTokens: 20 }),
      }),
    );
  });

  it("passes Anthropic SSE events through and settles terminal usage", async () => {
    const events = [
      {
        type: "message_start",
        message: {
          id: "msg_stream",
          model: "claude-sonnet-upstream",
          usage: { input_tokens: 80, output_tokens: 0 },
        },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "hello" },
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 12 },
      },
      { type: "message_stop" },
    ];
    mocks.stream.mockReturnValue({
      abort: vi.fn(),
      async *[Symbol.asyncIterator]() {
        yield* events;
      },
    });
    mocks.prepare.mockResolvedValue({
      ...ready,
      value: { ...ready.value, effectiveMaxOutputTokens: 128 },
    });

    const response = await handleAnthropicMessages(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        body: JSON.stringify({
          model: "claude-writing",
          max_tokens: 128,
          stream: true,
          messages: [{ role: "user", content: "hello" }],
        }),
      }),
    );
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: message_start");
    expect(body).toContain("event: message_stop");
    expect(mocks.markStreaming).toHaveBeenCalledWith("req_test");
    expect(mocks.finalizeKnown).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "succeeded",
        usage: expect.objectContaining({ inputTokens: 80, outputTokens: 12 }),
      }),
    );
  });

  it("rejects invalid JSON before preparing an upstream request", async () => {
    const response = await handleAnthropicMessages(
      new Request("http://localhost/v1/messages", {
        method: "POST",
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
