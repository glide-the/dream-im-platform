import { describe, expect, it } from "vitest";
import {
  applyAnthropicStreamEvent,
  applyOpenAIChatStreamChunk,
  applyOpenAIResponsesEvent,
  emptyTokenUsage,
  hasBillableTokens,
  parseAnthropicResponse,
  parseOpenAIChatResponse,
  totalProcessedTokens,
} from "./usage";

describe("Anthropic usage", () => {
  it("parses all billable buckets from a non-streaming response", () => {
    expect(
      parseAnthropicResponse({
        id: "msg_123",
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 20,
          output_tokens: 8,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 10,
        },
      }),
    ).toEqual({
      inputTokens: 20,
      outputTokens: 8,
      cacheReadTokens: 50,
      cacheWriteTokens: 10,
      inputTokenSemantics: "fresh",
      providerModel: "claude-opus-4-8",
      upstreamRequestId: "msg_123",
    });
  });

  it("accumulates message_start and cumulative message_delta usage", () => {
    let usage = emptyTokenUsage("fresh");
    usage = applyAnthropicStreamEvent(usage, {
      type: "message_start",
      message: {
        id: "msg_stream",
        model: "claude-opus-4-8",
        usage: {
          input_tokens: 100,
          output_tokens: 1,
          cache_read_input_tokens: 40,
        },
      },
    });
    usage = applyAnthropicStreamEvent(usage, {
      type: "message_delta",
      usage: { output_tokens: 25 },
    });

    expect(usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 25,
      cacheReadTokens: 40,
      upstreamRequestId: "msg_stream",
    });
  });
});

describe("totalProcessedTokens", () => {
  it("adds Anthropic cache buckets because fresh input excludes them", () => {
    expect(
      totalProcessedTokens({
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 10,
        inputTokenSemantics: "fresh",
      }),
    ).toBe(160);
  });

  it("does not double count OpenAI cached input", () => {
    expect(
      totalProcessedTokens({
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 30,
        cacheWriteTokens: 0,
        inputTokenSemantics: "total_including_cache",
      }),
    ).toBe(120);
  });
});

describe("OpenAI usage", () => {
  it("parses Chat Completions cache-inclusive input", () => {
    expect(
      parseOpenAIChatResponse({
        id: "chatcmpl_123",
        model: "gpt-example",
        usage: {
          prompt_tokens: 1_000,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 700 },
        },
      }),
    ).toMatchObject({
      inputTokens: 1_000,
      outputTokens: 50,
      cacheReadTokens: 700,
      inputTokenSemantics: "total_including_cache",
    });
  });

  it("keeps stream identity until the terminal usage chunk", () => {
    let usage = emptyTokenUsage("total_including_cache");
    usage = applyOpenAIChatStreamChunk(usage, {
      id: "chatcmpl_stream",
      model: "gpt-example",
      choices: [{ delta: { content: "hello" } }],
    });
    usage = applyOpenAIChatStreamChunk(usage, {
      id: "chatcmpl_stream",
      model: "gpt-example",
      choices: [],
      usage: { prompt_tokens: 15, completion_tokens: 7 },
    });
    expect(usage).toMatchObject({
      upstreamRequestId: "chatcmpl_stream",
      inputTokens: 15,
      outputTokens: 7,
    });
  });

  it("parses Responses API terminal usage", () => {
    const usage = applyOpenAIResponsesEvent(
      emptyTokenUsage("total_including_cache"),
      {
        type: "response.completed",
        response: {
          id: "resp_123",
          model: "gpt-example",
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            input_tokens_details: { cached_tokens: 80 },
          },
        },
      },
    );
    expect(usage).toMatchObject({
      upstreamRequestId: "resp_123",
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 80,
    });
  });
});

describe("hasBillableTokens", () => {
  it("keeps fully cached requests and drops only all-zero usage", () => {
    expect(
      hasBillableTokens({
        ...emptyTokenUsage("fresh"),
        cacheReadTokens: 1,
      }),
    ).toBe(true);
    expect(hasBillableTokens(emptyTokenUsage("fresh"))).toBe(false);
  });
});
