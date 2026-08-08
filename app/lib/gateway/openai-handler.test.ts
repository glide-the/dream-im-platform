import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleOpenAIChatCompletions } from "./openai-handler";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  create: vi.fn(),
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
  createOpenAIProviderClient: () => ({
    chat: { completions: { create: mocks.create } },
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
      scopes: ["chat:create"],
    },
    requestId: "req_openai",
    effectiveMaxOutputTokens: 256,
    estimatedTokens: 300,
    resolved: {
      model: {
        id: "model_2",
        code: "gpt-writing",
        upstreamModel: "gpt-5-upstream",
        displayName: "GPT Writing",
        capabilities: {},
      },
      provider: {
        id: "provider_2",
        code: "openai-primary",
        protocol: "openai" as const,
        baseUrl: "https://api.openai.com/v1",
        encryptedCredential: { ciphertext: "x", iv: "y", tag: "z" },
        timeoutMs: 10_000,
        maxRetries: 0,
        config: {},
      },
      pricingRuleId: "price_2",
      pricing: {
        inputPriceMicrousdPerMillion: 1_000_000,
        outputPriceMicrousdPerMillion: 4_000_000,
        cacheReadPriceMicrousdPerMillion: 100_000,
        cacheWritePriceMicrousdPerMillion: 0,
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

describe("OpenAI chat gateway handler", () => {
  it("proxies a completion with the resolved model and settles usage", async () => {
    mocks.create.mockResolvedValue({
      id: "chatcmpl_upstream",
      object: "chat.completion",
      created: 1,
      model: "gpt-5-upstream",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "ok", refusal: null },
          finish_reason: "stop",
          logprobs: null,
        },
      ],
      usage: {
        prompt_tokens: 120,
        completion_tokens: 30,
        total_tokens: 150,
        prompt_tokens_details: { cached_tokens: 20 },
      },
    });

    const response = await handleOpenAIChatCompletions(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-writing",
          messages: [{ role: "user", content: "hello" }],
          max_completion_tokens: 2_000,
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5-upstream",
        max_completion_tokens: 256,
        stream: false,
      }),
      expect.any(Object),
    );
    expect(mocks.finalizeKnown).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req_openai",
        usage: expect.objectContaining({
          inputTokens: 120,
          outputTokens: 30,
          cacheReadTokens: 20,
        }),
      }),
    );
  });

  it("forces include_usage for streams and emits the OpenAI terminator", async () => {
    const chunks = [
      {
        id: "chatcmpl_stream",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-5-upstream",
        choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
        usage: null,
      },
      {
        id: "chatcmpl_stream",
        object: "chat.completion.chunk",
        created: 1,
        model: "gpt-5-upstream",
        choices: [],
        usage: {
          prompt_tokens: 40,
          completion_tokens: 8,
          total_tokens: 48,
          prompt_tokens_details: { cached_tokens: 5 },
        },
      },
    ];
    mocks.create.mockResolvedValue({
      controller: new AbortController(),
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    });
    mocks.prepare.mockResolvedValue({
      ...ready,
      value: { ...ready.value, effectiveMaxOutputTokens: 128 },
    });

    const response = await handleOpenAIChatCompletions(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({
          model: "gpt-writing",
          messages: [{ role: "user", content: "hello" }],
          stream: true,
        }),
      }),
    );
    const body = await response.text();

    expect(body).toContain("chatcmpl_stream");
    expect(body).toContain("data: [DONE]");
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        stream_options: { include_usage: true },
      }),
      expect.any(Object),
    );
    expect(mocks.finalizeKnown).toHaveBeenCalledWith(
      expect.objectContaining({
        usage: expect.objectContaining({ inputTokens: 40, outputTokens: 8 }),
      }),
    );
  });
});
