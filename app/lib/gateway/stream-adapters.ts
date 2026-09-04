// [Input] Upstream Anthropic, OpenAI Chat, or Responses SSE bytes plus the public Gateway protocol target.
// [Output] Incrementally translated SSE events with usage, finish, and error semantics preserved.
// [Pos] Stateful streaming protocol boundary used by the Gateway proxy after transport authentication.
// [Sync] 2026-09-04: add Codex/xAI Responses stream translation while leaving Copilot on OpenAI Chat.

import {
  anthropicStopToOpenAI,
  openAIStopToAnthropic,
  record,
  type GatewayProtocol,
} from "./protocol-adapters";
import { ResponsesToOpenAIChatStreamState } from "./responses-adapter";

type JsonRecord = Record<string, unknown>;

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown) {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

class OpenAIToAnthropicStreamState {
  private started = false;
  private stopped = false;
  private nextBlock = 0;
  private textBlock?: number;
  private thinkingBlock?: number;
  private readonly toolBlocks = new Map<number, number>();
  private usage: JsonRecord = {};
  private finishReason: unknown = "stop";
  private id = "";
  private model: string;

  constructor(requestedModel: string) {
    this.model = requestedModel;
  }

  private start() {
    if (this.started) return [];
    this.started = true;
    return [{
      type: "message_start",
      message: {
        id: this.id || `msg_${crypto.randomUUID().replaceAll("-", "")}`,
        type: "message",
        role: "assistant",
        model: this.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: integer(this.usage.prompt_tokens), output_tokens: 0 },
      },
    }];
  }

  push(chunk: JsonRecord) {
    if (string(chunk.id)) this.id = string(chunk.id);
    if (string(chunk.model)) this.model = string(chunk.model);
    if (record(chunk.usage)) this.usage = record(chunk.usage) ?? this.usage;
    const events: JsonRecord[] = [...this.start()];
    for (const sourceChoice of array(chunk.choices)) {
      const choice = record(sourceChoice) ?? {};
      const delta = record(choice.delta) ?? {};
      const reasoning = string(delta.reasoning_content ?? delta.reasoning);
      if (reasoning) {
        if (this.thinkingBlock === undefined) {
          this.thinkingBlock = this.nextBlock++;
          events.push({ type: "content_block_start", index: this.thinkingBlock, content_block: { type: "thinking", thinking: "" } });
        }
        events.push({ type: "content_block_delta", index: this.thinkingBlock, delta: { type: "thinking_delta", thinking: reasoning } });
      }
      const content = string(delta.content);
      if (content) {
        if (this.textBlock === undefined) {
          this.textBlock = this.nextBlock++;
          events.push({ type: "content_block_start", index: this.textBlock, content_block: { type: "text", text: "" } });
        }
        events.push({ type: "content_block_delta", index: this.textBlock, delta: { type: "text_delta", text: content } });
      }
      for (const sourceCall of array(delta.tool_calls)) {
        const call = record(sourceCall) ?? {};
        const sourceIndex = integer(call.index);
        let blockIndex = this.toolBlocks.get(sourceIndex);
        const fn = record(call.function) ?? {};
        if (blockIndex === undefined) {
          blockIndex = this.nextBlock++;
          this.toolBlocks.set(sourceIndex, blockIndex);
          events.push({
            type: "content_block_start",
            index: blockIndex,
            content_block: { type: "tool_use", id: string(call.id) || `toolu_${crypto.randomUUID().replaceAll("-", "")}`, name: string(fn.name), input: {} },
          });
        }
        const argumentsDelta = string(fn.arguments);
        if (argumentsDelta) events.push({ type: "content_block_delta", index: blockIndex, delta: { type: "input_json_delta", partial_json: argumentsDelta } });
      }
      if (choice.finish_reason != null) this.finishReason = choice.finish_reason;
    }
    return events;
  }

  finish() {
    if (this.stopped) return [];
    this.stopped = true;
    const events: JsonRecord[] = [];
    if (!this.started) events.push(...this.start());
    if (this.thinkingBlock !== undefined) events.push({ type: "content_block_stop", index: this.thinkingBlock });
    if (this.textBlock !== undefined) events.push({ type: "content_block_stop", index: this.textBlock });
    for (const index of this.toolBlocks.values()) events.push({ type: "content_block_stop", index });
    const details = record(this.usage.prompt_tokens_details) ?? {};
    events.push({
      type: "message_delta",
      delta: { stop_reason: openAIStopToAnthropic(this.finishReason), stop_sequence: null },
      usage: {
        input_tokens: integer(this.usage.prompt_tokens),
        output_tokens: integer(this.usage.completion_tokens),
        cache_read_input_tokens: integer(details.cached_tokens),
        cache_creation_input_tokens: integer(details.cache_write_tokens),
      },
    });
    events.push({ type: "message_stop" });
    return events;
  }
}

class AnthropicToOpenAIStreamState {
  private id = `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`;
  private model: string;
  private created = Math.floor(Date.now() / 1_000);
  private roleSent = false;
  private finishReason: unknown = "end_turn";
  private usage: JsonRecord = {};
  private readonly blocks = new Map<number, JsonRecord>();

  constructor(requestedModel: string) {
    this.model = requestedModel;
  }

  private chunk(delta: JsonRecord, finishReason: unknown = null, usage?: JsonRecord) {
    return {
      id: this.id,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: finishReason === undefined ? [] : [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
      ...(usage ? { usage } : {}),
    };
  }

  push(event: JsonRecord) {
    const type = string(event.type);
    const chunks: JsonRecord[] = [];
    if (type === "message_start") {
      const message = record(event.message) ?? {};
      if (string(message.id)) this.id = string(message.id).replace(/^msg_/, "chatcmpl_");
      if (string(message.model)) this.model = string(message.model);
      if (record(message.usage)) this.usage = { ...this.usage, ...record(message.usage) };
      if (!this.roleSent) {
        this.roleSent = true;
        chunks.push(this.chunk({ role: "assistant", content: "" }));
      }
    } else if (type === "content_block_start") {
      const index = integer(event.index);
      const block = record(event.content_block) ?? {};
      this.blocks.set(index, block);
      if (block.type === "tool_use") {
        chunks.push(this.chunk({ tool_calls: [{ index, id: string(block.id), type: "function", function: { name: string(block.name), arguments: "" } }] }));
      }
    } else if (type === "content_block_delta") {
      const index = integer(event.index);
      const delta = record(event.delta) ?? {};
      if (delta.type === "text_delta") chunks.push(this.chunk({ content: string(delta.text) }));
      if (delta.type === "thinking_delta") chunks.push(this.chunk({ reasoning_content: string(delta.thinking) }));
      if (delta.type === "input_json_delta") chunks.push(this.chunk({ tool_calls: [{ index, function: { arguments: string(delta.partial_json) } }] }));
    } else if (type === "message_delta") {
      const delta = record(event.delta) ?? {};
      this.finishReason = delta.stop_reason ?? this.finishReason;
      if (record(event.usage)) this.usage = { ...this.usage, ...record(event.usage) };
    }
    return chunks;
  }

  finish() {
    const cached = integer(this.usage.cache_read_input_tokens);
    const cacheWrite = integer(this.usage.cache_creation_input_tokens);
    const prompt = integer(this.usage.input_tokens) + cached + cacheWrite;
    const completion = integer(this.usage.output_tokens);
    return [
      this.chunk({}, anthropicStopToOpenAI(this.finishReason)),
      {
        id: this.id,
        object: "chat.completion.chunk",
        created: this.created,
        model: this.model,
        choices: [],
        usage: {
          prompt_tokens: prompt,
          completion_tokens: completion,
          total_tokens: prompt + completion,
          prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: cacheWrite },
        },
      },
    ];
  }
}

export type ProtocolStreamAdapter = {
  push(eventType: string, data: JsonRecord): JsonRecord[];
  finish(): JsonRecord[];
};

export function createProtocolStreamAdapter(input: {
  externalProtocol: GatewayProtocol;
  providerProtocol: GatewayProtocol;
  providerAdapterKind?: string;
  requestedModel: string;
}): ProtocolStreamAdapter {
  if (input.providerAdapterKind === "codex" || input.providerAdapterKind === "xai") {
    const responses = new ResponsesToOpenAIChatStreamState(input.requestedModel);
    if (input.externalProtocol === "openai") {
      return {
        push: (_eventType, data) => responses.push(data),
        finish: () => responses.finish(),
      };
    }
    const anthropic = new OpenAIToAnthropicStreamState(input.requestedModel);
    return {
      push: (_eventType, data) => responses.push(data).flatMap((chunk) => anthropic.push(chunk)),
      finish: () => [
        ...responses.finish().flatMap((chunk) => anthropic.push(chunk)),
        ...anthropic.finish(),
      ],
    };
  }
  if (input.externalProtocol === "anthropic" && input.providerProtocol === "openai") {
    const state = new OpenAIToAnthropicStreamState(input.requestedModel);
    return { push: (_eventType, data) => state.push(data), finish: () => state.finish() };
  }
  if (input.externalProtocol === "openai" && input.providerProtocol === "anthropic") {
    const state = new AnthropicToOpenAIStreamState(input.requestedModel);
    return { push: (_eventType, data) => state.push(data), finish: () => state.finish() };
  }
  return {
    push: (_eventType, data) => [data],
    finish: () => [],
  };
}
