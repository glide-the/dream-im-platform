// [Input] Representative OpenAI Chat requests and Responses JSON/SSE payloads.
// [Output] Regression proof for text, tools, reasoning, usage, error, and multimodal contracts.
// [Pos] Focused contract suite for the Codex/xAI Responses dialect boundary.
// [Sync] 2026-10-03: cover sparse terminal output, snapshots, tools and failed aggregation.
// [Sync] 2026-09-04: cover the product OAuth Gateway conversion matrix.
// [Sync] 2026-10-05: confirm late tool arguments are finalized at response completion, not empty item end events.

import { describe, expect, it } from "vitest";
import {
  openAIChatRequestToResponses,
  ResponsesToOpenAIChatStreamState,
  ResponsesStreamResponseState,
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


describe("Responses SSE aggregation", () => {
  it("retains late tool arguments after empty done events in Chat streaming and JSON aggregation", () => {
    const chat = new ResponsesToOpenAIChatStreamState("alias");
    const aggregate = new ResponsesStreamResponseState();
    const item = { type: "function_call", id: "fc_late", call_id: "call_late", name: "lookup", arguments: "" };
    const events = [
      { type: "response.output_item.added", output_index: 0, item },
      { type: "response.function_call_arguments.done", output_index: 0, item_id: "fc_late", arguments: "" },
      { type: "response.output_item.done", output_index: 0, item },
      { type: "response.function_call_arguments.delta", output_index: 0, item_id: "fc_late", delta: '{"q":1}' },
      { type: "response.completed", response: { status: "completed", usage: { input_tokens: 5, output_tokens: 2 } } },
    ];
    const chunks = events.flatMap((event) => chat.push(event));
    const argumentsText = chunks.flatMap((chunk) => chunk.choices ?? [])
      .flatMap((choice: { delta?: { tool_calls?: { function?: { arguments?: string } }[] } }) => choice.delta?.tool_calls ?? [])
      .map((call: { function?: { arguments?: string } }) => call.function?.arguments ?? "").join("");
    expect(argumentsText).toBe('{"q":1}');
    expect(chunks.slice(0, -1).every((chunk) => chunk.choices?.[0]?.finish_reason == null)).toBe(true);
    expect(chunks.at(-1)).toMatchObject({ choices: [{ finish_reason: "tool_calls" }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    let result;
    for (const event of events) result = aggregate.push(event);
    expect(responsesResponseToOpenAIChat(result!, "alias")).toMatchObject({
      choices: [{ message: { tool_calls: [{ function: { arguments: '{"q":1}' } }] } }],
    });
  });

  it("uses done snapshots without duplicating deltas and orders output by index", () => {
    const state = new ResponsesStreamResponseState();
    state.push({ type: "response.output_item.added", output_index: 1, item: { type: "function_call", id: "fc", call_id: "call", name: "lookup", arguments: "" } });
    state.push({ type: "response.function_call_arguments.delta", output_index: 1, delta: "{}" });
    state.push({ type: "response.function_call_arguments.done", output_index: 1, arguments: "{}" });
    state.push({ type: "response.output_text.delta", output_index: 0, delta: "hi" });
    state.push({ type: "response.output_item.done", output_index: 0, item: { type: "message", content: [{ type: "output_text", text: "hi" }] } });
    state.push({ type: "response.reasoning_summary_text.delta", output_index: 2, delta: "brief" });
    const result = state.push({ type: "response.completed", response: { status: "completed", usage: { input_tokens: 5, output_tokens: 2 } } });
    expect(responsesResponseToOpenAIChat(result!, "alias")).toMatchObject({
      choices: [{ message: { content: "hi", reasoning_content: "brief", tool_calls: [{ function: { arguments: "{}" } }] }, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
  });

  it("keeps complete terminal output authoritative", () => {
    const state = new ResponsesStreamResponseState();
    state.push({ type: "response.output_text.delta", delta: "partial" });
    const response = { status: "incomplete", output: [{ type: "message", content: [{ type: "output_text", text: "complete" }] }] };
    expect(state.push({ type: "response.incomplete", response })).toBe(response);
  });

  it("requires a terminal event and rejects failures even after receiving text", () => {
    const state = new ResponsesStreamResponseState();
    expect(state.push({ type: "response.output_text.delta", delta: "partial" })).toBeUndefined();
    expect(() => state.push({ type: "response.failed", response: { status: "failed" } })).toThrow(/request failed/);
  });
});
