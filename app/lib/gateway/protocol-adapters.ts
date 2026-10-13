// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Sync] 2026-10-10: preserve user image blocks in the existing cross-protocol request conversion.
// [Input] Validated public Anthropic/OpenAI requests plus target protocol, product adapter, and model policy.
// [Output] Upstream request bodies and JSON responses translated across Messages, Chat, and Responses dialects.
// [Pos] Pure Gateway protocol boundary; transport, authentication, streaming, and persistence stay outside.
// [Sync] 2026-09-04: route Codex/xAI through Responses while retaining generic and Copilot Chat behavior.
// [Sync] 2026-10-10: use each selected Provider's explicit API configuration for request and response conversion.

import { anthropicMessageSchema, openAIChatCompletionSchema } from "./protocols";
import { GatewayError } from "./errors";
import { imageApiPolicy } from "../../../config/image-api-policy";
import { validateBase64Image } from "./image-protocols";
import { resolveResponsesAdapter } from "./provider-endpoint";
import {
  openAIChatRequestToResponses,
  responsesResponseToOpenAIChat,
} from "./responses-adapter";

type JsonRecord = Record<string, unknown>;
export type GatewayProtocol = "anthropic" | "openai";
export type ProtocolMatrix = `${GatewayProtocol}:${GatewayProtocol}`;

export const anthropicToOpenAIRequestSchema = anthropicMessageSchema;
export const openAIToAnthropicRequestSchema = openAIChatCompletionSchema;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function int(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}

function anthropicContentToOpenAI(content: unknown) {
  if (typeof content === "string") return content;
  const parts = array(content);
  const converted: JsonRecord[] = [];
  for (const block of parts) {
    const part = record(block);
    if (part?.type === "text") converted.push({ type: "text", text: text(part.text) });
    if (part?.type === "image") {
      const source = record(part.source);
      const url = source?.type === "base64" && text(source.media_type) && text(source.data)
        ? `data:${text(source.media_type)};base64,${text(source.data)}`
        : source?.type === "url" ? text(source.url) : "";
      if (!url) throw new GatewayError("UPSTREAM_DIALECT_UNSUPPORTED", "Invalid image content", 400, "invalid_request_error");
      converted.push({ type: "image_url", image_url: { url } });
    }
  }
  return converted.length ? converted : text(parts.map((part) => record(part)?.text).filter(Boolean).join("\n"));
}

function nativeImageHistory(blocks: unknown[], role: string) {
  const starts = blocks.map(record).filter(part => part?.type === "server_tool_use" && part.name === "image_generation");
  const results = blocks.map(record).filter(part => part?.type === "image_generation_tool_result");
  const invalid = () => new GatewayError("UPSTREAM_DIALECT_UNSUPPORTED", "The saved image result is invalid. Add the image file to a new message", 400, "invalid_request_error");
  if (!starts.length && !results.length) return new Map<unknown, { id: string; data: string; media: string }>();
  if (role !== "assistant" || starts.length !== results.length || new Set(starts.map(part => part!.id)).size !== starts.length) throw invalid();
  const pairs = new Map<unknown, { id: string; data: string; media: string }>();
  for (const result of results) {
    const start = starts.find(part => part!.id === result!.tool_use_id);
    const content = array(result!.content), image = record(content[0]), source = record(image?.source);
    const data = text(source?.data), media = text(source?.media_type), id = text(start?.id);
    if (!start || !/^[A-Za-z0-9._:-]{1,200}$/.test(id) || pairs.size >= starts.length
      || [...pairs.values()].some(pair => pair.id === id) || content.length !== 1 || image?.type !== "image"
      || source?.type !== "base64" || !["image/png", "image/jpeg", "image/webp"].includes(media)
      || !data || data.length > Math.ceil(imageApiPolicy.maxImageBytes / 3) * 4
      || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)
      || Buffer.from(data, "base64").byteLength > imageApiPolicy.maxImageBytes
      || Buffer.from(data, "base64").toString("base64") !== data) throw invalid();
    pairs.set(result, { id, data, media });
  }
  return pairs;
}

export async function validateNativeImageHistory(body: unknown) {
  const parsed = record(body);
  if (!parsed) throw new GatewayError("UPSTREAM_DIALECT_UNSUPPORTED", "Invalid conversation history", 400, "invalid_request_error");
  for (const value of array(parsed.messages)) {
    const message = record(value);
    if (!message) continue;
    for (const image of nativeImageHistory(array(message.content), text(message.role)).values()) {
      try {
        if (await validateBase64Image(image.data) !== image.media) throw new Error("Image format mismatch");
      } catch {
        throw new GatewayError("UPSTREAM_DIALECT_UNSUPPORTED", "The saved image cannot be read. Add its image file to a new message", 400, "invalid_request_error");
      }
    }
  }
}

export function nativeHistoryForAnthropic(body: JsonRecord) {
  return { ...body, messages: array(body.messages).flatMap(value => {
    const message = record(value);
    if (!message || !Array.isArray(message.content)) return [value];
    const native = nativeImageHistory(message.content, text(message.role));
    if (!native.size) return [value];
    const output: unknown[] = []; let content: unknown[] = [];
    for (const block of message.content) {
      const image = native.get(block);
      if (image) {
        if (content.length) output.push({ ...message, content });
        content = [];
        output.push({ role: "user", content: [{ type: "text", text: `Previously generated image: ${image.id}` },
          { type: "image", source: { type: "base64", media_type: image.media, data: image.data } }] });
      } else if (!(record(block)?.type === "server_tool_use" && record(block)?.name === "image_generation")) content.push(block);
    }
    if (content.length) output.push({ ...message, content });
    return output;
  }) };
}

export function anthropicRequestToOpenAI(body: JsonRecord, model: string, preserveNativeImages = false) {
  const messages: JsonRecord[] = [];
  const systemParts: string[] = [];
  if (body.system) {
    const value = anthropicContentToOpenAI(body.system);
    if (typeof value === "string" && value) systemParts.push(value);
    else if (Array.isArray(value)) systemParts.push(value.map((part) => text(record(part)?.text)).filter(Boolean).join("\n"));
  }
  for (const sourceMessage of array(body.messages)) {
    const message = record(sourceMessage);
    if (!message) continue;
    if (message.role === "system") {
      const value = anthropicContentToOpenAI(message.content);
      if (typeof value === "string" && value) systemParts.push(value);
      else if (Array.isArray(value)) systemParts.push(value.map((part) => text(record(part)?.text)).filter(Boolean).join("\n"));
      continue;
    }
    const role = message.role === "assistant" ? "assistant" : "user";
    const blocks = array(message.content);
    const native = nativeImageHistory(blocks, role);
    if (!blocks.length || typeof message.content === "string") {
      messages.push({ role, content: anthropicContentToOpenAI(message.content) });
      continue;
    }
    const normalBlocks = blocks.filter((block) => {
      const type = record(block)?.type;
      return type === "text" || type === "image";
    });
    if (normalBlocks.length && !native.size) {
      messages.push({ role, content: anthropicContentToOpenAI(normalBlocks) });
    }
    for (const block of blocks) {
      const item = record(block);
      if (native.size && (item?.type === "text" || item?.type === "image")) {
        messages.push({ role, content: anthropicContentToOpenAI([block]) });
      } else if (item?.type === "tool_use") {
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [{
            id: text(item.id),
            type: "function",
            function: { name: text(item.name), arguments: JSON.stringify(item.input ?? {}) },
          }],
        });
      } else if (native.has(block)) {
        const image = native.get(block)!;
        messages.push(preserveNativeImages ? { ink_native_image_call: { type: "image_generation_call", id: image.id, result: image.data, status: "completed" } }
          : { role: "user", content: [{ type: "text", text: `Previously generated image: ${image.id}` }, { type: "image_url", image_url: { url: `data:${image.media};base64,${image.data}` } }] });
      } else if (item?.type === "tool_result") {
        messages.push({
          role: "tool",
          tool_call_id: text(item.tool_use_id),
          content: array(item.content).some((block) => record(block)?.type === "image")
            ? anthropicContentToOpenAI(item.content)
            : typeof item.content === "string" ? item.content : JSON.stringify(item.content ?? ""),
        });
      }
    }
  }
  if (systemParts.some(Boolean)) {
    messages.unshift({ role: "system", content: systemParts.filter(Boolean).join("\n\n") });
  }
  const tools = array(body.tools).map((tool) => {
    const value = record(tool) ?? {};
    return {
      type: "function",
      function: {
        name: text(value.name),
        description: text(value.description) || undefined,
        parameters: value.input_schema ?? { type: "object", properties: {} },
      },
    };
  });
  const toolChoice = record(body.tool_choice);
  return {
    model,
    messages,
    stream: Boolean(body.stream),
    max_completion_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop_sequences,
    ...(tools.length ? { tools } : {}),
    ...(toolChoice?.type === "any" ? { tool_choice: "required" } : {}),
    ...(toolChoice?.type === "auto" ? { tool_choice: "auto" } : {}),
    ...(toolChoice?.type === "tool" ? { tool_choice: { type: "function", function: { name: toolChoice.name } } } : {}),
  };
}

export function openAIRequestToAnthropic(body: JsonRecord, model: string) {
  const system: unknown[] = [];
  const messages: JsonRecord[] = [];
  for (const sourceMessage of array(body.messages)) {
    const message = record(sourceMessage);
    if (!message) continue;
    if (message.role === "system" || message.role === "developer") {
      system.push({ type: "text", text: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "") });
      continue;
    }
    if (message.role === "tool") {
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: text(message.tool_call_id), content: message.content ?? "" }],
      });
      continue;
    }
    const content: unknown[] = [];
    if (typeof message.content === "string" && message.content) {
      content.push({ type: "text", text: message.content });
    } else {
      for (const part of array(message.content)) {
        const value = record(part);
        if (value?.type === "text") content.push({ type: "text", text: text(value.text) });
      }
    }
    for (const sourceCall of array(message.tool_calls)) {
      const call = record(sourceCall);
      const fn = record(call?.function);
      let input: unknown = {};
      try { input = JSON.parse(text(fn?.arguments) || "{}"); } catch { input = { _raw: text(fn?.arguments) }; }
      content.push({ type: "tool_use", id: text(call?.id), name: text(fn?.name), input });
    }
    messages.push({ role: message.role === "assistant" ? "assistant" : "user", content });
  }
  const tools = array(body.tools).map((sourceTool) => {
    const tool = record(sourceTool);
    const fn = record(tool?.function);
    return { name: text(fn?.name), description: text(fn?.description) || undefined, input_schema: fn?.parameters ?? { type: "object", properties: {} } };
  });
  const choice = body.tool_choice;
  const mappedChoice = choice === "required"
    ? { type: "any" }
    : choice === "auto" || choice === undefined
      ? { type: "auto" }
      : record(choice)?.type === "function"
        ? { type: "tool", name: record(record(choice)?.function)?.name }
        : undefined;
  return {
    model,
    messages,
    stream: Boolean(body.stream),
    max_tokens: body.max_completion_tokens ?? body.max_tokens ?? 4_096,
    ...(system.length ? { system } : {}),
    ...(tools.length ? { tools } : {}),
    ...(mappedChoice ? { tool_choice: mappedChoice } : {}),
    temperature: body.temperature,
    top_p: body.top_p,
    stop_sequences: typeof body.stop === "string" ? [body.stop] : body.stop,
  };
}

function anthropicStopToOpenAI(reason: unknown) {
  if (reason === "max_tokens") return "length";
  if (reason === "tool_use") return "tool_calls";
  if (reason === "refusal") return "content_filter";
  return "stop";
}

function openAIStopToAnthropic(reason: unknown) {
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  if (reason === "content_filter") return "refusal";
  return "end_turn";
}

export function openAIResponseToAnthropic(body: JsonRecord, requestedModel: string) {
  const choice = record(array(body.choices)[0]) ?? {};
  const message = record(choice.message) ?? {};
  const content: unknown[] = [];
  if (text(message.content)) content.push({ type: "text", text: text(message.content) });
  if (text(message.reasoning_content)) content.push({ type: "thinking", thinking: text(message.reasoning_content) });
  for (const sourceCall of array(message.tool_calls)) {
    const call = record(sourceCall) ?? {};
    const fn = record(call.function) ?? {};
    let input: unknown = {};
    try { input = JSON.parse(text(fn.arguments) || "{}"); } catch { input = { _raw: text(fn.arguments) }; }
    content.push({ type: "tool_use", id: text(call.id), name: text(fn.name), input });
  }
  const usage = record(body.usage) ?? {};
  return {
    id: text(body.id) || `msg_${crypto.randomUUID().replaceAll("-", "")}`,
    type: "message",
    role: "assistant",
    model: text(body.model) || requestedModel,
    content,
    stop_reason: openAIStopToAnthropic(choice.finish_reason),
    stop_sequence: null,
    usage: {
      input_tokens: int(usage.prompt_tokens),
      output_tokens: int(usage.completion_tokens),
      cache_read_input_tokens: int(record(usage.prompt_tokens_details)?.cached_tokens),
      cache_creation_input_tokens: int(record(usage.prompt_tokens_details)?.cache_write_tokens),
    },
  };
}

export function anthropicResponseToOpenAI(body: JsonRecord, requestedModel: string) {
  const content = array(body.content);
  const textContent = content.filter((item) => record(item)?.type === "text").map((item) => text(record(item)?.text)).join("");
  const thinking = content.filter((item) => record(item)?.type === "thinking").map((item) => text(record(item)?.thinking)).join("");
  const toolCalls = content.filter((item) => record(item)?.type === "tool_use").map((item) => {
    const value = record(item) ?? {};
    return { id: text(value.id), type: "function", function: { name: text(value.name), arguments: JSON.stringify(value.input ?? {}) } };
  });
  const usage = record(body.usage) ?? {};
  const cached = int(usage.cache_read_input_tokens);
  const cacheWrite = int(usage.cache_creation_input_tokens);
  const promptTokens = int(usage.input_tokens) + cached + cacheWrite;
  return {
    id: text(body.id) || `chatcmpl_${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1_000),
    model: text(body.model) || requestedModel,
    choices: [{ index: 0, message: { role: "assistant", content: textContent || null, ...(thinking ? { reasoning_content: thinking } : {}), ...(toolCalls.length ? { tool_calls: toolCalls } : {}) }, finish_reason: anthropicStopToOpenAI(body.stop_reason), logprobs: null }],
    usage: { prompt_tokens: promptTokens, completion_tokens: int(usage.output_tokens), total_tokens: promptTokens + int(usage.output_tokens), prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: cacheWrite } },
  };
}

export function adaptProviderRequest(input: {
  externalProtocol: GatewayProtocol;
  providerProtocol: GatewayProtocol;
  providerAdapterKind?: string;
  providerConfig?: JsonRecord;
  body: JsonRecord;
  model: string;
  maxOutputTokens: number;
}) {
  const matrix: ProtocolMatrix = `${input.externalProtocol}:${input.providerProtocol}`;
  const responsesAdapter = resolveResponsesAdapter({ protocol: input.providerProtocol, adapterKind: input.providerAdapterKind, config: input.providerConfig });
  if (responsesAdapter) {
    const openAIChatBody = input.externalProtocol === "anthropic"
      ? anthropicRequestToOpenAI(
          { ...input.body, max_tokens: input.maxOutputTokens },
          input.model,
          true,
        )
      : {
          ...input.body,
          model: input.model,
          max_completion_tokens: input.maxOutputTokens,
          stream: Boolean(input.body.stream),
        };
    return openAIChatRequestToResponses({
      body: openAIChatBody,
      model: input.model,
      adapterKind: responsesAdapter,
      stream: Boolean(input.body.stream),
      maxOutputTokens: input.maxOutputTokens,
      allowNativeImageHistory: input.externalProtocol === "anthropic",
    });
  }
  if (matrix === "anthropic:openai") {
    return anthropicRequestToOpenAI({ ...input.body, max_tokens: input.maxOutputTokens }, input.model);
  }
  if (matrix === "openai:anthropic") {
    return openAIRequestToAnthropic({ ...input.body, max_completion_tokens: input.maxOutputTokens }, input.model);
  }
  return { ...(matrix === "anthropic:anthropic" ? nativeHistoryForAnthropic(input.body) : input.body), model: input.model, ...(input.externalProtocol === "anthropic" ? { max_tokens: input.maxOutputTokens } : {}), stream: Boolean(input.body.stream) };
}

export function adaptProviderResponse(input: {
  externalProtocol: GatewayProtocol;
  providerProtocol: GatewayProtocol;
  providerAdapterKind?: string;
  providerConfig?: JsonRecord;
  body: JsonRecord;
  requestedModel: string;
}) {
  const matrix: ProtocolMatrix = `${input.externalProtocol}:${input.providerProtocol}`;
  if (resolveResponsesAdapter({ protocol: input.providerProtocol, adapterKind: input.providerAdapterKind, config: input.providerConfig })) {
    const chat = responsesResponseToOpenAIChat(input.body, input.requestedModel);
    return input.externalProtocol === "anthropic"
      ? openAIResponseToAnthropic(chat, input.requestedModel)
      : chat;
  }
  if (matrix === "anthropic:openai") return openAIResponseToAnthropic(input.body, input.requestedModel);
  if (matrix === "openai:anthropic") return anthropicResponseToOpenAI(input.body, input.requestedModel);
  return input.body;
}

export { anthropicStopToOpenAI, openAIStopToAnthropic, record };
