// [Input] Representative OpenAI Chat requests and Responses JSON/SSE payloads.
// [Output] Regression proof for text, tools, reasoning, usage, error, and multimodal contracts.
// [Pos] Focused contract suite for the Codex/xAI Responses dialect boundary.
// [Sync] 2026-09-04: cover the product OAuth Gateway conversion matrix.

import { describe, expect, it } from "vitest";
import {
  openAIChatRequestToResponses,
  ResponsesToOpenAIChatStreamState,
  responsesResponseToOpenAIChat,
} from "./responses-adapter";

describe("Responses product dialect", () => {
  it("lifts instructions, function calls, tool results, and reasoning effort", () => {
    const result = openAIChatRequestToResponses({
      adapterKind: "xai",
      model: "grok-code",
      stream: false,
      maxOutputTokens: 123,
      body: {
        messages: [
          { role: "system", content: "policy" },
          { role: "developer", content: "format" },
          { role: "user", content: "hello" },
          { role: "assistant", content: null, tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: "{\"q\":1}" } }] },
          { role: "tool", tool_call_id: "call_1", content: "done" },
        ],
        tools: [{ type: "function", function: { name: "lookup", parameters: { type: "object" } } }],
        tool_choice: { type: "function", function: { name: "lookup" } },
        reasoning_effort: "high",
      },
    });
    expect(result).toMatchObject({
      model: "grok-code",
      instructions: "policy\n\nformat",
      max_output_tokens: 123,
      reasoning: { effort: "high" },
      tool_choice: { type: "function", name: "lookup" },
    });
    expect(result.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user" }),
      expect.objectContaining({ type: "function_call", call_id: "call_1" }),
      expect.objectContaining({ type: "function_call_output", call_id: "call_1" }),
    ]));
  });

  it("enforces the Codex request surface and rejects multimodal input", () => {
    const result = openAIChatRequestToResponses({
      adapterKind: "codex",
      model: "gpt-codex",
      stream: false,
      maxOutputTokens: 999,
      body: { messages: [{ role: "user", content: "hello" }], temperature: 1 },
    });
    expect(result).toMatchObject({
      stream: true,
      store: false,
      include: ["reasoning.encrypted_content"],
      instructions: "",
      tools: [],
    });
    expect(result).not.toHaveProperty("max_output_tokens");
    expect(result).not.toHaveProperty("temperature");

    expect(() => openAIChatRequestToResponses({
      adapterKind: "codex",
      model: "gpt-codex",
      stream: true,
      maxOutputTokens: 10,
      body: { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "data:x" } }] }] },
    })).toThrow(/multimodal/i);
  });

  it("maps output text, function calls, stop reason, and usage", () => {
    const result = responsesResponseToOpenAIChat({
      id: "resp_1",
      model: "gpt-codex",
      status: "completed",
      output: [
        { type: "reasoning", summary: [{ type: "summary_text", text: "brief" }] },
        { type: "message", content: [{ type: "output_text", text: "answer" }] },
        { type: "function_call", call_id: "call_1", name: "lookup", arguments: "{\"q\":1}" },
      ],
      usage: { input_tokens: 7, output_tokens: 3, input_tokens_details: { cached_tokens: 2 } },
    }, "alias");
    expect(result).toMatchObject({
      choices: [{ message: { content: "answer", reasoning_content: "brief", tool_calls: [{ id: "call_1" }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10, prompt_tokens_details: { cached_tokens: 2 } },
    });
  });

  it("maps named Responses stream events without duplicating terminal content", () => {
    const state = new ResponsesToOpenAIChatStreamState("alias");
    const events = [
      ...state.push({ type: "response.created", response: { id: "resp_1", model: "gpt" } }),
      ...state.push({ type: "response.output_text.delta", delta: "hi" }),
      ...state.push({ type: "response.output_item.added", item: { id: "fc_1", type: "function_call", call_id: "call_1", name: "lookup", arguments: "" } }),
      ...state.push({ type: "response.function_call_arguments.delta", item_id: "fc_1", delta: "{\"q\":1}" }),
      ...state.push({ type: "response.completed", response: { id: "resp_1", model: "gpt", usage: { input_tokens: 5, output_tokens: 2 } } }),
      ...state.finish(),
    ];
    expect(events.some((event) => event.choices?.[0]?.delta?.content === "hi")).toBe(true);
    expect(events.some((event) => event.choices?.[0]?.delta?.tool_calls?.[0]?.function?.arguments === "{\"q\":1}")).toBe(true);
    expect(events.at(-1)).toMatchObject({ usage: { prompt_tokens: 5, completion_tokens: 2 }, choices: [{ finish_reason: "tool_calls" }] });
  });

  it("rejects failed terminal Responses objects", () => {
    expect(() => responsesResponseToOpenAIChat({
      id: "resp_failed",
      status: "failed",
      error: { message: "denied" },
      output: [],
    }, "alias")).toThrow(/request failed/);
  });
});
