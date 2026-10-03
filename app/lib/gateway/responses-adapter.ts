// [Input] Normalized OpenAI Chat requests and OpenAI Responses JSON/SSE events.
// [Output] Loss-bounded request, response, and stream conversions for Codex/xAI product adapters.
// [Pos] Product-dialect boundary between the public Anthropic/OpenAI Gateway and Responses-only upstreams.
// [Sync] 2026-09-04: add the shared Codex/xAI Responses contract without exposing product credentials.
// [Sync] 2026-10-03: reconstruct non-streaming output from SSE when terminal output is omitted.

import { GatewayError } from "./errors";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function jsonText(value: unknown) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return "";
  }
}

function messageText(content: unknown) {
  if (typeof content === "string") return content;
  const parts: string[] = [];
  for (const sourcePart of array(content)) {
    const part = record(sourcePart);
    const type = text(part?.type);
    if (type === "text" || type === "input_text" || type === "output_text") {
      parts.push(text(part?.text));
      continue;
    }
    throw new GatewayError(
      "UPSTREAM_DIALECT_UNSUPPORTED",
      "The selected product adapter does not support this multimodal input",
      400,
      "invalid_request_error",
    );
  }
  return parts.join("");
}

function responseInput(body: JsonRecord) {
  const input: JsonRecord[] = [];
  const instructions: string[] = [];
  for (const sourceMessage of array(body.messages)) {
    const message = record(sourceMessage);
    if (!message) continue;
    const role = text(message.role);
    if (role === "system" || role === "developer") {
      const value = messageText(message.content);
      if (value) instructions.push(value);
      continue;
    }
    if (role === "tool") {
      input.push({
        type: "function_call_output",
        call_id: text(message.tool_call_id),
        output: jsonText(message.content),
      });
      continue;
    }
    if (role === "function") {
      throw new GatewayError(
        "UPSTREAM_DIALECT_UNSUPPORTED",
        "Legacy function messages are not supported by this product adapter",
        400,
        "invalid_request_error",
      );
    }

    const content = messageText(message.content);
    if (content) {
      input.push({
        role: role === "assistant" ? "assistant" : "user",
        content: [{
          type: role === "assistant" ? "output_text" : "input_text",
          text: content,
        }],
      });
    }
    for (const sourceCall of array(message.tool_calls)) {
      const call = record(sourceCall);
      const fn = record(call?.function);
      input.push({
        type: "function_call",
        call_id: text(call?.id),
        name: text(fn?.name),
        arguments: text(fn?.arguments) || "{}",
      });
    }
  }
  return { input, instructions: instructions.join("\n\n") };
}

function responseTools(body: JsonRecord) {
  return array(body.tools).map((sourceTool) => {
    const tool = record(sourceTool);
    const fn = record(tool?.function);
    return {
      type: "function",
      name: text(fn?.name),
      ...(text(fn?.description) ? { description: text(fn?.description) } : {}),
      parameters: fn?.parameters ?? { type: "object", properties: {} },
      ...(typeof fn?.strict === "boolean" ? { strict: fn.strict } : {}),
    };
  });
}

function responseToolChoice(choice: unknown) {
  if (typeof choice === "string") return choice;
  const value = record(choice);
  const fn = record(value?.function);
  if (value?.type === "function" && text(fn?.name)) {
    return { type: "function", name: text(fn?.name) };
  }
  return undefined;
}

export function openAIChatRequestToResponses(input: {
  body: JsonRecord;
  model: string;
  adapterKind: "codex" | "xai";
  stream: boolean;
  maxOutputTokens: number;
}) {
  const converted = responseInput(input.body);
  const tools = responseTools(input.body);
  const choice = responseToolChoice(input.body.tool_choice);
  const configuredReasoning = record(input.body.reasoning);
  const reasoningEffort = text(configuredReasoning?.effort)
    || text(input.body.reasoning_effort);
  const output: JsonRecord = {
    model: input.model,
    input: converted.input,
    instructions: converted.instructions,
    tools,
    parallel_tool_calls: Boolean(input.body.parallel_tool_calls),
    stream: input.adapterKind === "codex" ? true : input.stream,
    ...(choice !== undefined ? { tool_choice: choice } : {}),
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
  };

  if (input.adapterKind === "codex") {
    output.store = false;
    output.include = ["reasoning.encrypted_content"];
  } else {
    output.max_output_tokens = input.maxOutputTokens;
    if (typeof input.body.temperature === "number") output.temperature = input.body.temperature;
    if (typeof input.body.top_p === "number") output.top_p = input.body.top_p;
  }
  return output;
}

function responseStopReason(response: JsonRecord, hasToolCalls: boolean) {
  if (hasToolCalls) return "tool_calls";
  if (response.status === "incomplete") {
    const reason = text(record(response.incomplete_details)?.reason);
    return reason === "max_output_tokens" || reason === "max_tokens" ? "length" : "stop";
  }
  return "stop";
}

function assertSuccessfulResponse(response: JsonRecord) {
  const status = text(response.status);
  if (status === "failed" || status === "cancelled") {
    throw new GatewayError(
      "UPSTREAM_RESPONSE_FAILED",
      `The upstream Responses request ${status}`,
      502,
      "upstream_error",
    );
  }
}

export function responsesResponseToOpenAIChat(body: JsonRecord, requestedModel: string) {
  assertSuccessfulResponse(body);
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const toolCalls: JsonRecord[] = [];
  for (const sourceItem of array(body.output)) {
    const item = record(sourceItem);
    if (!item) continue;
    if (item.type === "message") {
      for (const sourcePart of array(item.content)) {
        const part = record(sourcePart);
        if (part?.type === "output_text") textParts.push(text(part.text));
        if (part?.type === "refusal") textParts.push(text(part.refusal));
      }
    } else if (item.type === "function_call") {
      toolCalls.push({
        id: text(item.call_id) || text(item.id),
        type: "function",
        function: {
          name: text(item.name),
          arguments: text(item.arguments) || "{}",
        },
      });
    } else if (item.type === "reasoning") {
      for (const sourceSummary of array(item.summary)) {
        const summary = record(sourceSummary);
        if (summary?.type === "summary_text") reasoningParts.push(text(summary.text));
      }
    }
  }
  const usage = record(body.usage) ?? {};
  const inputDetails = record(usage.input_tokens_details) ?? {};
  const promptTokens = integer(usage.input_tokens);
  const completionTokens = integer(usage.output_tokens);
  return {
    id: text(body.id) || `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model: text(body.model) || requestedModel,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: textParts.join("") || null,
        ...(reasoningParts.length ? { reasoning_content: reasoningParts.join("\n") } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: responseStopReason(body, toolCalls.length > 0),
      logprobs: null,
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      prompt_tokens_details: {
        cached_tokens: integer(inputDetails.cached_tokens),
        cache_write_tokens: integer(inputDetails.cache_write_tokens),
      },
    },
  };
}

export class ResponsesToOpenAIChatStreamState {
  private id = `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`;
  private model: string;
  private created = Math.floor(Date.now() / 1_000);
  private roleSent = false;
  private terminal = false;
  private finishReason: "stop" | "length" | "tool_calls" = "stop";
  private readonly toolIndexes = new Map<string, number>();

  constructor(requestedModel: string) {
    this.model = requestedModel;
  }

  private chunk(delta: JsonRecord, finishReason: unknown = null, usage?: JsonRecord) {
    return {
      id: this.id,
      object: "chat.completion.chunk",
      created: this.created,
      model: this.model,
      choices: [{ index: 0, delta, finish_reason: finishReason, logprobs: null }],
      ...(usage ? { usage } : {}),
    };
  }

  private role() {
    if (this.roleSent) return [];
    this.roleSent = true;
    return [this.chunk({ role: "assistant", content: "" })];
  }

  push(event: JsonRecord) {
    const type = text(event.type);
    const outputs: JsonRecord[] = [];
    const response = record(event.response);
    if (response) {
      if (text(response.id)) this.id = text(response.id).replace(/^resp_/, "chatcmpl_");
      if (text(response.model)) this.model = text(response.model);
    }
    if (type === "response.failed" || type === "response.cancelled") {
      assertSuccessfulResponse(response ?? { status: type.replace("response.", ""), error: event.error });
    }
    if (type === "response.created" || type === "response.in_progress") {
      outputs.push(...this.role());
    } else if (type === "response.output_text.delta") {
      outputs.push(...this.role(), this.chunk({ content: text(event.delta) }));
    } else if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") {
      outputs.push(...this.role(), this.chunk({ reasoning_content: text(event.delta) }));
    } else if (type === "response.output_item.added") {
      const item = record(event.item);
      if (item?.type === "function_call") {
        const key = text(item.id) || text(item.call_id);
        const index = this.toolIndexes.size;
        this.toolIndexes.set(key, index);
        this.finishReason = "tool_calls";
        outputs.push(...this.role(), this.chunk({
          tool_calls: [{
            index,
            id: text(item.call_id) || text(item.id),
            type: "function",
            function: { name: text(item.name), arguments: text(item.arguments) },
          }],
        }));
      }
    } else if (type === "response.function_call_arguments.delta") {
      const key = text(event.item_id) || text(event.call_id);
      const index = this.toolIndexes.get(key) ?? 0;
      outputs.push(...this.role(), this.chunk({
        tool_calls: [{ index, function: { arguments: text(event.delta) } }],
      }));
    } else if (type === "response.completed" || type === "response.incomplete") {
      this.terminal = true;
      const value = response ?? event;
      if (type === "response.incomplete") this.finishReason = "length";
      const usage = record(value.usage) ?? {};
      const inputDetails = record(usage.input_tokens_details) ?? {};
      const prompt = integer(usage.input_tokens);
      const completion = integer(usage.output_tokens);
      outputs.push(...this.role(), this.chunk({}, this.finishReason, {
        prompt_tokens: prompt,
        completion_tokens: completion,
        total_tokens: prompt + completion,
        prompt_tokens_details: {
          cached_tokens: integer(inputDetails.cached_tokens),
          cache_write_tokens: integer(inputDetails.cache_write_tokens),
        },
      }));
    }
    return outputs;
  }

  finish() {
    return this.terminal ? [] : this.role();
  }
}

export function responseObjectFromEvent(event: JsonRecord) {
  const type = text(event.type);
  if (type === "response.failed" || type === "response.cancelled") {
    assertSuccessfulResponse(record(event.response) ?? { status: type.replace("response.", ""), error: event.error });
  }
  if (type === "response.completed" || type === "response.incomplete") {
    return record(event.response) ?? event;
  }
  return undefined;
}

/** Retains output snapshots and deltas; terminal metadata and usage remain authoritative. */
export class ResponsesStreamResponseState {
  private readonly items = new Map<number, JsonRecord>();

  push(event: JsonRecord) {
    const type = text(event.type);
    const index = integer(event.output_index);
    const snapshot = record(event.item);
    if (type === "response.output_item.added" || type === "response.output_item.done") {
      if (snapshot) this.items.set(index, structuredClone(snapshot));
    } else if (type === "response.output_text.delta" || type === "response.output_text.done"
      || type === "response.refusal.delta" || type === "response.refusal.done"
      || type === "response.content_part.added" || type === "response.content_part.done") {
      const item = this.items.get(index) ?? { type: "message", role: "assistant", content: [] };
      const content = array(item.content);
      const partIndex = integer(event.content_index);
      const refusal = type.startsWith("response.refusal.");
      const field = refusal ? "refusal" : "text";
      const part = record(content[partIndex]) ?? { type: refusal ? "refusal" : "output_text" };
      if (type.startsWith("response.content_part.")) {
        content[partIndex] = record(event.part) ?? part;
      } else {
        part[field] = type.endsWith(".delta") ? text(part[field]) + text(event.delta) : text(event[field]);
        content[partIndex] = part;
      }
      item.content = content;
      this.items.set(index, item);
    } else if (type === "response.function_call_arguments.delta" || type === "response.function_call_arguments.done") {
      const item = this.items.get(index);
      if (item?.type === "function_call") {
        item.arguments = type.endsWith(".delta") ? text(item.arguments) + text(event.delta) : text(event.arguments);
      }
    } else if (type === "response.reasoning_summary_text.delta" || type === "response.reasoning_summary_text.done") {
      const item = this.items.get(index) ?? { type: "reasoning", summary: [] };
      const summary = array(item.summary);
      const summaryIndex = integer(event.summary_index);
      const part = record(summary[summaryIndex]) ?? { type: "summary_text" };
      part.text = type.endsWith(".delta") ? text(part.text) + text(event.delta) : text(event.text);
      summary[summaryIndex] = part;
      item.summary = summary;
      this.items.set(index, item);
    }
    const terminal = responseObjectFromEvent(event);
    if (!terminal) return undefined;
    // Some product endpoints send the complete output only in preceding item events.
    if (array(terminal.output).length > 0) return terminal;
    return { ...terminal, output: [...this.items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item) };
  }
}
