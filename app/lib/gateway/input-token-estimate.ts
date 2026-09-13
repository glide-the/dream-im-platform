// [Input] Parsed Anthropic/OpenAI content, resolved Provider protocol, and server-owned image estimate.
// [Output] An approximate input token reservation separating image blocks from JSON text.
// [Pos] Pure Gateway input estimate; it does not change requests, context limits, or actual usage.
// [Sync] 2026-09-13: separate native image encodings from text and retain cross-protocol JSON estimates.

import { GatewayError } from "./errors";
import { estimateJsonTokens } from "./request-body";

// Reservation estimate, not a model capability. Claude's current high-resolution
// visual-token budget is 4784; other providers can set their own server estimate.
const DEFAULT_IMAGE_INPUT_TOKEN_ESTIMATE = 4_784;

function imageInputTokenEstimate() {
  const raw = process.env.GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE;
  if (raw === undefined) return DEFAULT_IMAGE_INPUT_TOKEN_ESTIMATE;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GatewayError(
      "GATEWAY_IMAGE_TOKEN_ESTIMATE_INVALID",
      "GATEWAY_IMAGE_INPUT_TOKEN_ESTIMATE must be a positive safe integer",
      503,
      "configuration_error",
    );
  }
  return value;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function estimateInputTokens(
  protocol: "anthropic" | "openai",
  input: { messages: unknown; system?: unknown; tools?: unknown; response_format?: unknown },
  providerProtocol: "anthropic" | "openai" = protocol,
) {
  // Existing cross-protocol adapters may stringify image tool results as real
  // text. Keep their original conservative estimate until conversion supports
  // images, rather than under-reserving that upstream text.
  if (providerProtocol !== protocol) return estimateJsonTokens(input);
  let imageCount = 0;
  const content = (value: unknown): unknown => {
    // Never inspect strings as JSON: base64 printed by Bash/Read is real text.
    if (!Array.isArray(value)) return value;
    return value.map((item) => {
      const block = record(item);
      if (!block) return item;
      const source = record(block.source);
      const imageUrl = record(block.image_url);
      const isAnthropicImage = protocol === "anthropic" && block.type === "image"
        && source && (
          (source.type === "base64" && typeof source.data === "string" && typeof source.media_type === "string")
          || (source.type === "url" && typeof source.url === "string")
          || (source.type === "file" && typeof source.file_id === "string")
        );
      const isOpenAIImage = protocol === "openai" && block.type === "image_url"
        && imageUrl && typeof imageUrl.url === "string";
      if (isAnthropicImage || isOpenAIImage) {
        imageCount += 1;
        // Drop encoding only from the estimation projection, never the request.
        return { type: block.type };
      }
      if (protocol === "anthropic" && block.type === "tool_result") {
        return { ...block, content: content(block.content) };
      }
      return item;
    });
  };
  const projected = {
    ...input,
    messages: Array.isArray(input.messages) ? input.messages.map((item) => {
      const message = record(item);
      return message ? { ...message, content: content(message.content) } : item;
    }) : input.messages,
    ...(input.system !== undefined ? { system: content(input.system) } : {}),
  };
  const estimate = estimateJsonTokens(projected)
    + (imageCount ? imageCount * imageInputTokenEstimate() : 0);
  if (!Number.isSafeInteger(estimate)) {
    throw new GatewayError(
      "REQUEST_TOKEN_ESTIMATE_INVALID",
      "The request token estimate is outside the supported range",
      400,
      "invalid_request_error",
    );
  }
  return estimate;
}
