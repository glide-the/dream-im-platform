// [Input] Explicit Provider API configuration and controlled protocol responses.
// [Output] Regression evidence for selected wire dialect and preserved compatibility.
// [Pos] Provider-free Gateway protocol contracts.
// [Sync] 2026-10-10: cover explicit generic Responses selection, original defaults and fail-closed ownership.
import { describe, expect, it } from "vitest";
import {
  adaptProviderRequest,
  adaptProviderResponse,
  anthropicRequestToOpenAI,
  anthropicResponseToOpenAI,
  openAIRequestToAnthropic,
  openAIResponseToAnthropic,
} from "./protocol-adapters";

describe("explicit Anthropic/OpenAI protocol adapters", () => {
  it("routes managed Codex and xAI providers through the Responses dialect", () => {
    const codex = adaptProviderRequest({
      externalProtocol: "openai",
      providerProtocol: "openai",
      providerAdapterKind: "codex",
      body: { messages: [{ role: "user", content: "hello" }], stream: false },
      model: "gpt-codex",
      maxOutputTokens: 128,
    });
    expect(codex).toMatchObject({ model: "gpt-codex", stream: true, store: false });
    const xai = adaptProviderRequest({
      externalProtocol: "anthropic",
      providerProtocol: "openai",
      providerAdapterKind: "xai",
      body: { messages: [{ role: "user", content: "hello" }], max_tokens: 64, stream: false },
      model: "grok-code",
      maxOutputTokens: 64,
    });
    expect(xai).toMatchObject({ model: "grok-code", stream: false, max_output_tokens: 64 });
  });

  it("maps Anthropic tools, tool results and request limits to OpenAI", () => {
    const result = anthropicRequestToOpenAI({
      max_tokens: 100,
      system: "system",
      messages: [
        { role: "assistant", content: [{ type: "tool_use", id: "toolu_1", name: "search", input: { q: "ink" } }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "found" }] },
      ],
      tools: [{ name: "search", input_schema: { type: "object" } }],
    }, "gpt-upstream");
    expect(result).toMatchObject({ model: "gpt-upstream", max_completion_tokens: 100, tools: [{ function: { name: "search" } }] });
    expect(result.messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: "tool", tool_call_id: "toolu_1" })]));
  });

  it("collapses Claude Code system-role messages into one OpenAI system prefix", () => {
    const result = anthropicRequestToOpenAI({
      max_tokens: 100,
      system: [{ type: "text", text: "base system" }],
      messages: [
        { role: "user", content: "hello" },
        { role: "system", content: [{ type: "text", text: "runtime control" }] },
        { role: "assistant", content: "answer" },
      ],
    }, "gpt-upstream");
    expect(result.messages).toEqual([
      { role: "system", content: "base system\n\nruntime control" },
      { role: "user", content: "hello" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("maps OpenAI tool calls to Anthropic tool_use", () => {
    const result = openAIRequestToAnthropic({ messages: [{ role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "write", arguments: '{"x":1}' } }] }], max_completion_tokens: 20 }, "claude-upstream");
    expect(result).toMatchObject({ model: "claude-upstream", max_tokens: 20, messages: [{ role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "write", input: { x: 1 } }] }] });
  });

  it("maps OpenAI response usage, cached tokens and finish reason to Anthropic", () => {
    const result = openAIResponseToAnthropic({ id: "chat_1", model: "gpt", choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{ id: "call_1", function: { name: "write", arguments: "{}" } }] } }], usage: { prompt_tokens: 10, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } } }, "alias");
    expect(result).toMatchObject({ stop_reason: "tool_use", usage: { input_tokens: 10, output_tokens: 3, cache_read_input_tokens: 4 }, content: [{ type: "tool_use" }] });
  });

  it("maps Anthropic thinking, tools and cache usage to OpenAI", () => {
    const result = anthropicResponseToOpenAI({ id: "msg_1", model: "claude", stop_reason: "max_tokens", content: [{ type: "thinking", thinking: "reason" }, { type: "text", text: "answer" }, { type: "tool_use", id: "toolu_1", name: "write", input: { x: 1 } }], usage: { input_tokens: 6, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } }, "alias");
    expect(result).toMatchObject({ choices: [{ finish_reason: "length", message: { content: "answer", reasoning_content: "reason", tool_calls: [{ id: "toolu_1" }] } }], usage: { prompt_tokens: 12, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4, cache_write_tokens: 2 } } });
  });
  it("uses generic Responses only when explicitly configured and preserves ordinary tools and images", () => {
    const input = { externalProtocol: "anthropic" as const, providerProtocol: "openai" as const,
      body: { messages: [{ role: "user", content: [{ type: "text", text: "hello" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } }] }],
        tools: [{ name: "search", input_schema: { type: "object" } }], stream: false }, model: "upstream", maxOutputTokens: 64 };
    expect(adaptProviderRequest(input)).toHaveProperty("messages");
    const responses = adaptProviderRequest({ ...input, providerConfig: { openaiApi: "responses" } });
    expect(responses).toMatchObject({ store: false, stream: false, max_output_tokens: 64, tools: [{ type: "function", name: "search" }] });
    expect(responses).not.toHaveProperty("messages");
    expect(JSON.stringify(responses)).toContain('"type":"input_image"');
    expect(JSON.stringify(responses)).not.toContain('"type":"image_generation"');
    expect(adaptProviderResponse({ externalProtocol: "anthropic", providerProtocol: "openai", providerConfig: { openaiApi: "responses" }, requestedModel: "alias", body: {
      id: "resp_generic", status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: "answer" }] }], usage: { input_tokens: 7, output_tokens: 2 },
    } })).toMatchObject({ id: "resp_generic", content: [{ type: "text", text: "answer" }], usage: { input_tokens: 7, output_tokens: 2 } });
  });

});
