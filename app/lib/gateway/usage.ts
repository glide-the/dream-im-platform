import type { InputTokenSemantics, TokenUsage } from "../billing/types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function tokenValue(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function nestedToken(source: JsonRecord | undefined, paths: string[][]) {
  for (const path of paths) {
    let current: unknown = source;
    for (const key of path) current = record(current)?.[key];
    const value = tokenValue(current);
    if (value !== undefined) return value;
  }
  return 0;
}

export function emptyTokenUsage(
  inputTokenSemantics: InputTokenSemantics,
): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokenSemantics,
  };
}

function anthropicUsage(
  usage: JsonRecord | undefined,
  current: TokenUsage,
): TokenUsage {
  if (!usage) return current;
  return {
    ...current,
    inputTokens: tokenValue(usage.input_tokens) ?? current.inputTokens,
    outputTokens: tokenValue(usage.output_tokens) ?? current.outputTokens,
    cacheReadTokens:
      tokenValue(usage.cache_read_input_tokens) ?? current.cacheReadTokens,
    cacheWriteTokens:
      tokenValue(usage.cache_creation_input_tokens) ?? current.cacheWriteTokens,
  };
}

export function parseAnthropicResponse(body: unknown): TokenUsage | null {
  const response = record(body);
  const usage = record(response?.usage);
  if (!response || !usage) return null;
  return {
    ...anthropicUsage(usage, emptyTokenUsage("fresh")),
    providerModel: stringValue(response.model),
    upstreamRequestId: stringValue(response.id),
  };
}

export function applyAnthropicStreamEvent(
  current: TokenUsage,
  event: unknown,
): TokenUsage {
  const value = record(event);
  const type = stringValue(value?.type);
  if (!value || !type) return current;

  if (type === "message_start") {
    const message = record(value.message);
    return {
      ...anthropicUsage(record(message?.usage), current),
      providerModel: stringValue(message?.model) ?? current.providerModel,
      upstreamRequestId:
        stringValue(message?.id) ?? current.upstreamRequestId,
    };
  }
  if (type === "message_delta") {
    return anthropicUsage(record(value.usage), current);
  }
  return current;
}

function openAiUsage(
  usage: JsonRecord,
  inputField: "prompt_tokens" | "input_tokens",
  outputField: "completion_tokens" | "output_tokens",
  current: TokenUsage,
) {
  return {
    ...current,
    inputTokens: tokenValue(usage[inputField]) ?? current.inputTokens,
    outputTokens: tokenValue(usage[outputField]) ?? current.outputTokens,
    cacheReadTokens: nestedToken(usage, [
      ["prompt_tokens_details", "cached_tokens"],
      ["input_tokens_details", "cached_tokens"],
      ["cache_read_input_tokens"],
    ]),
    cacheWriteTokens: nestedToken(usage, [
      ["prompt_tokens_details", "cache_write_tokens"],
      ["input_tokens_details", "cache_write_tokens"],
      ["cache_creation_input_tokens"],
    ]),
  } satisfies TokenUsage;
}

export function parseOpenAIChatResponse(body: unknown): TokenUsage | null {
  const response = record(body);
  const usage = record(response?.usage);
  if (!response || !usage) return null;
  return {
    ...openAiUsage(
      usage,
      "prompt_tokens",
      "completion_tokens",
      emptyTokenUsage("total_including_cache"),
    ),
    providerModel: stringValue(response.model),
    upstreamRequestId: stringValue(response.id),
  };
}

export function applyOpenAIChatStreamChunk(
  current: TokenUsage,
  chunk: unknown,
): TokenUsage {
  const value = record(chunk);
  const usage = record(value?.usage);
  if (!value) return current;
  const withIdentity = {
    ...current,
    providerModel: stringValue(value.model) ?? current.providerModel,
    upstreamRequestId: stringValue(value.id) ?? current.upstreamRequestId,
  };
  return usage
    ? openAiUsage(
        usage,
        "prompt_tokens",
        "completion_tokens",
        withIdentity,
      )
    : withIdentity;
}

export function applyOpenAIResponsesEvent(
  current: TokenUsage,
  event: unknown,
): TokenUsage {
  const value = record(event);
  if (stringValue(value?.type) !== "response.completed") return current;
  const response = record(value?.response);
  const usage = record(response?.usage);
  if (!response || !usage) return current;
  return {
    ...openAiUsage(
      usage,
      "input_tokens",
      "output_tokens",
      current,
    ),
    providerModel: stringValue(response.model) ?? current.providerModel,
    upstreamRequestId:
      stringValue(response.id) ?? current.upstreamRequestId,
  };
}

export function hasBillableTokens(usage: TokenUsage) {
  return (
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    usage.cacheReadTokens > 0 ||
    usage.cacheWriteTokens > 0
  );
}
