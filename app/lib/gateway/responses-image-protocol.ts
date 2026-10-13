// [Input] A completed Responses object and server-bound operation/call identity.
// [Output] Fully decoded image results and a byte-free, prompt-free identity summary; no invented Image usage.
// [Pos] Responses image decoder shared by the bound Gateway and Admin capability verification.
// [Sync] 2026-10-11: expose decoded output without inventing Gateway identity for Admin verification.
// [Sync] 2026-10-11: validate official inclusive ResponseUsage separately from unknown complete image billing details.
// [Sync] 2026-10-10: reuse Images byte validation while keeping Responses identities and unknown billing separate.
import { createHash } from "node:crypto";
import { z } from "zod";
import { imageApiPolicy } from "../../../config/image-api-policy";
import { GatewayError } from "./errors";
import { validateBase64Image } from "./image-protocols";
import type { TokenUsage } from "../billing/types";

const identity = z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/);
const completedCall = z.object({
  type: z.literal("image_generation_call"),
  id: identity,
  status: z.literal("completed"),
  result: z.string().min(1).max(Math.ceil(imageApiPolicy.maxImageBytes / 3) * 4),
  action: z.enum(["generate", "edit"]).optional(),
  output_format: z.enum(["png", "jpeg", "webp"]).optional(),
});
const envelope = z.object({
  id: identity,
  status: z.literal("completed"),
  output: z.array(z.unknown()),
});
const binding = z.strictObject({
  gatewayRequestId: z.string().regex(/^req_[0-9a-f]{32}$/),
  providerHttpRequestId: identity.nullable(),
  operation: z.enum(["generate", "edit"]),
  maxOutputImages: z.number().int().min(1).max(imageApiPolicy.maxOutputImages),
  configuredImageModel: z.string().trim().min(1).max(200).nullable(),
});
const outputPolicy = binding.pick({ operation: true, maxOutputImages: true });

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const reportedUsage = z.object({
  input_tokens: tokenCount,
  output_tokens: tokenCount,
  total_tokens: tokenCount,
  input_tokens_details: z.object({ cached_tokens: tokenCount, cache_write_tokens: tokenCount.optional().default(0) }),
  output_tokens_details: z.object({ reasoning_tokens: tokenCount }),
}).refine(value => Number.isSafeInteger(value.input_tokens + value.output_tokens)
  && value.total_tokens === value.input_tokens + value.output_tokens
  && value.input_tokens_details.cached_tokens + value.input_tokens_details.cache_write_tokens <= value.input_tokens
  && value.output_tokens_details.reasoning_tokens <= value.output_tokens);

/** Official request-wide counts are inclusive; hosted-image engine/cost details are a separate fact. */
export function parseResponsesReportedUsage(value: unknown): {
  status: "reported" | "missing" | "invalid";
  usage: TokenUsage | null;
  responsesUsage: z.output<typeof reportedUsage> | null;
} {
  const response = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  if (response?.usage === undefined || response.usage === null) return { status: "missing", usage: null, responsesUsage: null };
  const parsed = reportedUsage.safeParse(response.usage);
  if (!parsed.success) return { status: "invalid", usage: null, responsesUsage: null };
  const counts = parsed.data;
  const responseId = identity.safeParse(response.id);
  const model = identity.safeParse(response.model);
  return {
    status: "reported",
    responsesUsage: counts,
    usage: {
      inputTokens: counts.input_tokens, outputTokens: counts.output_tokens,
      cacheReadTokens: counts.input_tokens_details.cached_tokens,
      cacheWriteTokens: counts.input_tokens_details.cache_write_tokens,
      inputTokenSemantics: "total_including_cache",
      ...(responseId.success ? { upstreamRequestId: responseId.data } : {}),
      ...(model.success ? { providerModel: model.data } : {}),
    },
  };
}

function invalid() {
  return new GatewayError("UPSTREAM_RESPONSES_IMAGE_INVALID", "The upstream Responses image result does not match the bound operation", 502, "upstream_error");
}

export async function parseResponsesImageOutput(value: unknown, input: z.input<typeof outputPolicy>) {
  const bound = outputPolicy.safeParse(input);
  const parsed = envelope.safeParse(value);
  if (!bound.success || !parsed.success) throw invalid();
  const sourceCalls = parsed.data.output.flatMap((item, outputIndex) =>
    item && typeof item === "object" && "type" in item && item.type === "image_generation_call"
      ? [{ item, outputIndex }] : []);
  if (!sourceCalls.length || sourceCalls.length > bound.data.maxOutputImages) throw invalid();
  const ids = new Set<string>();
  const images = [];
  const summaries = [];
  let totalBytes = 0;
  let encodedBytes = 0;
  for (const source of sourceCalls) {
    const call = completedCall.safeParse(source.item);
    if (!call.success || ids.has(call.data.id) || (call.data.action && call.data.action !== bound.data.operation)) throw invalid();
    ids.add(call.data.id);
    const mediaType = await validateBase64Image(call.data.result);
    const format = mediaType === "image/jpeg" ? "jpeg" : mediaType === "image/webp" ? "webp" : "png";
    if (call.data.output_format && call.data.output_format !== format) throw invalid();
    const bytes = Buffer.from(call.data.result, "base64");
    // Buffer accepts noncanonical padding bits; reject rather than silently changing output bytes.
    if (bytes.toString("base64") !== call.data.result) throw invalid();
    totalBytes += bytes.byteLength;
    encodedBytes += call.data.result.length;
    if (!Number.isSafeInteger(totalBytes) || !Number.isSafeInteger(encodedBytes)
      || encodedBytes > imageApiPolicy.maxResponseBytes) throw invalid();
    const summary = {
      callId: call.data.id,
      outputIndex: source.outputIndex,
      status: "completed" as const,
      operation: bound.data.operation,
      reportedAction: call.data.action ?? null,
      format,
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    summaries.push(summary);
    images.push({ ...summary, mediaType, b64Json: call.data.result });
  }
  return {
    responseId: parsed.data.id,
    images,
    imageCalls: summaries,
  };
}

export async function parseResponsesImageResult(value: unknown, input: z.input<typeof binding>) {
  const bound = binding.safeParse(input);
  if (!bound.success) throw invalid();
  const output = await parseResponsesImageOutput(value, {
    operation: bound.data.operation,
    maxOutputImages: bound.data.maxOutputImages,
  });
  return {
    responseId: output.responseId,
    images: output.images,
    summary: {
      gatewayRequestId: bound.data.gatewayRequestId,
      responseId: output.responseId,
      providerHttpRequestId: bound.data.providerHttpRequestId,
      configuredImageModel: bound.data.configuredImageModel,
      // The public Responses output schema does not report the Image engine identity or its per-call usage.
      reportedImageModel: null,
      usageKnown: false as const,
      usageUnknownReason: "responses_image_usage_not_reported" as const,
      imageCalls: output.imageCalls,
    },
  };
}
