import { describe, expect, it } from "vitest";
import { createProtocolStreamAdapter } from "./stream-adapters";

describe("cross-protocol stream state machines", () => {
  it("converts OpenAI text, thinking, tool arguments and usage into ordered Anthropic events", () => {
    const adapter = createProtocolStreamAdapter({ externalProtocol: "anthropic", providerProtocol: "openai", requestedModel: "alias" });
    const output = [
      ...adapter.push("message", { id: "chat_1", model: "gpt", choices: [{ delta: { reasoning_content: "think" }, finish_reason: null }] }),
      ...adapter.push("message", { id: "chat_1", model: "gpt", choices: [{ delta: { content: "hello", tool_calls: [{ index: 0, id: "call_1", function: { name: "write", arguments: '{"x"' } }] }, finish_reason: null }] }),
      ...adapter.push("message", { id: "chat_1", model: "gpt", choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ":1}" } }] }, finish_reason: "tool_calls" }] }),
      ...adapter.push("message", { id: "chat_1", model: "gpt", choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 2 } } }),
      ...adapter.finish(),
    ];
    expect(output.map((event) => event.type)).toEqual(expect.arrayContaining(["message_start", "content_block_start", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]));
    expect(output).toEqual(expect.arrayContaining([expect.objectContaining({ delta: { type: "thinking_delta", thinking: "think" } }), expect.objectContaining({ delta: { type: "input_json_delta", partial_json: ":1}" } }), expect.objectContaining({ usage: expect.objectContaining({ output_tokens: 5, cache_read_input_tokens: 2 }) })]));
  });

  it("converts Anthropic deltas, tool input and final usage into OpenAI chunks", () => {
    const adapter = createProtocolStreamAdapter({ externalProtocol: "openai", providerProtocol: "anthropic", requestedModel: "alias" });
    const output = [
      ...adapter.push("message_start", { type: "message_start", message: { id: "msg_1", model: "claude", usage: { input_tokens: 6, cache_read_input_tokens: 3 } } }),
      ...adapter.push("content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "write", input: {} } }),
      ...adapter.push("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{}" } }),
      ...adapter.push("message_delta", { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 4 } }),
      ...adapter.finish(),
    ];
    expect(output).toEqual(expect.arrayContaining([expect.objectContaining({ choices: [expect.objectContaining({ delta: expect.objectContaining({ tool_calls: expect.any(Array) }) })] }), expect.objectContaining({ choices: [expect.objectContaining({ finish_reason: "tool_calls" })] }), expect.objectContaining({ choices: [], usage: expect.objectContaining({ prompt_tokens: 9, completion_tokens: 4 }) })]));
  });
});
