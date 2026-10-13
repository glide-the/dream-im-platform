// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] OpenAI-compatible JSON/multipart Image requests and bounded Provider JSON responses.
// [Output] Strict normalized generation/edit contracts, validated image bytes, and reliable Token usage.
// [Pos] Images protocol boundary; it never persists prompts, image bytes, or base64 output.
// [Sync] 2026-10-09: fully decode bounded input/output images and return only allowlisted response fields.
// [Sync] 2026-10-10: share bounded image decoding with the separately gated Responses result protocol.

import { z } from "zod";
import sharp from "sharp";

import { imageApiPolicy } from "../../../config/image-api-policy";
import type { TokenUsage } from "../billing/types";
import { GatewayError } from "./errors";
import { BodyLimitExceededError, readLimitedBody } from "./read-limited-body";
import { parseGatewayJson } from "./request-body";

const promptSchema = z.string().min(1).refine(
  (value) => Buffer.byteLength(value, "utf8") <= imageApiPolicy.maxPromptBytes,
  `prompt exceeds the ${imageApiPolicy.maxPromptBytes} byte limit`,
);
const modelSchema = z.string().trim().min(1).max(200);
const imageOptionsSchema = {
  n: z.number().int().min(1).max(imageApiPolicy.maxOutputImages).default(1),
  quality: z.enum(["auto", "low", "medium", "high"]).optional(),
  size: z.string().regex(/^(auto|[1-9]\d{1,4}x[1-9]\d{1,4})$/).optional(),
  background: z.enum(["auto", "transparent", "opaque"]).optional(),
  output_format: z.enum(["png", "jpeg", "webp"]).optional(),
  output_compression: z.number().int().min(0).max(100).optional(),
  moderation: z.enum(["auto", "low"]).optional(),
} as const;

export const imageGenerationRequestSchema = z.strictObject({
  model: modelSchema,
  prompt: promptSchema,
  ...imageOptionsSchema,
});

const imageEditScalarsSchema = z.strictObject({
  model: modelSchema,
  prompt: promptSchema,
  n: z.coerce.number().int().min(1).max(imageApiPolicy.maxOutputImages).default(1),
  quality: imageOptionsSchema.quality,
  size: imageOptionsSchema.size,
  background: imageOptionsSchema.background,
  output_format: imageOptionsSchema.output_format,
  output_compression: z.coerce.number().int().min(0).max(100).optional(),
});

export type ImageGenerationRequest = z.infer<typeof imageGenerationRequestSchema>;
export type ImageEditScalars = z.infer<typeof imageEditScalarsSchema>;
export type ValidatedImageFile = Readonly<{
  file: File;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
}>;
export type ImageEditRequest = Readonly<{
  fields: ImageEditScalars;
  images: readonly ValidatedImageFile[];
  mask?: ValidatedImageFile;
}>;

function invalidRequest(message: string, code = "INVALID_REQUEST") {
  return new GatewayError(code, message, 400, "invalid_request_error");
}

type SupportedImageMime = "image/png" | "image/jpeg" | "image/webp";
function detectedImageMime(bytes: Uint8Array, allowGif: true): SupportedImageMime | "image/gif" | undefined;
function detectedImageMime(bytes: Uint8Array, allowGif?: false): SupportedImageMime | undefined;
function detectedImageMime(bytes: Uint8Array, allowGif = false) {
  if (allowGif && bytes.length >= 6 && ["GIF87a", "GIF89a"].includes(Buffer.from(bytes.slice(0, 6)).toString("ascii"))) return "image/gif" as const;
  if (
    bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
    && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a
    && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return "image/png" as const;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg" as const;
  }
  if (
    bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) return "image/webp" as const;
  return undefined;
}

function decodedImageMime(bytes: Uint8Array, allowGif: true): Promise<SupportedImageMime | "image/gif" | undefined>;
function decodedImageMime(bytes: Uint8Array, allowGif?: false): Promise<SupportedImageMime | undefined>;
async function decodedImageMime(bytes: Uint8Array, allowGif = false) {
  const image = sharp(bytes, {
    failOn: "error",
    limitInputPixels: imageApiPolicy.maxImagePixels,
    animated: false,
  });
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || (!allowGif && (metadata.pages ?? 1) !== 1)) {
    return undefined;
  }
  const mimeType = allowGif && metadata.format === "gif" ? "image/gif" as const : metadata.format === "png"
    ? "image/png" as const
    : metadata.format === "jpeg"
      ? "image/jpeg" as const
      : metadata.format === "webp"
        ? "image/webp" as const
        : undefined;
  if (!mimeType) return undefined;
  // metadata() can accept a valid header followed by a truncated payload.
  // Raw conversion forces libvips to decode the complete bounded image.
  await image.raw().toBuffer();
      return mimeType;
}

async function validateImageFile(
  file: File,
  input: { field: string; pngOnly?: boolean },
): Promise<ValidatedImageFile> {
  if (file.size < 1 || file.size > imageApiPolicy.maxImageBytes) {
    throw invalidRequest(
      `${input.field} must contain 1-${imageApiPolicy.maxImageBytes} bytes`,
      "IMAGE_FILE_SIZE_INVALID",
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const magic = detectedImageMime(bytes);
  let detected: Awaited<ReturnType<typeof decodedImageMime>>;
  try {
    detected = magic ? await decodedImageMime(bytes) : undefined;
  } catch {
    detected = undefined;
  }
  const declared = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (
    !detected
    || detected !== magic
    || declared !== detected
    || (input.pngOnly && detected !== "image/png")
  ) {
    throw invalidRequest(
      input.pngOnly
        ? `${input.field} must be a PNG file with matching content`
        : `${input.field} must be a PNG, JPEG, or WebP file with matching content`,
      "IMAGE_FILE_TYPE_INVALID",
    );
  }
  return { file, mimeType: detected };
}

function uniqueScalar(
  entries: Map<string, FormDataEntryValue[]>,
  name: string,
) {
  const values = entries.get(name) ?? [];
  if (values.length > 1 || values.some((value) => typeof value !== "string")) {
    throw invalidRequest(`${name} must be supplied exactly once as text`);
  }
  return values[0] as string | undefined;
}

export async function parseImageGenerationRequest(request: Request) {
  return await parseGatewayJson(request, imageGenerationRequestSchema);
}

export async function parseImageEditRequest(request: Request): Promise<ImageEditRequest> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    throw invalidRequest("Image edits require multipart/form-data", "INVALID_CONTENT_TYPE");
  }
  let form: FormData;
  try {
    const bytes = await readLimitedBody({
      body: request.body,
      declaredLength: request.headers.get("content-length"),
      maxBytes: imageApiPolicy.maxMultipartBytes,
    });
    form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: bytes,
    }).formData();
  } catch (error) {
    if (error instanceof BodyLimitExceededError) {
      throw new GatewayError(
        "REQUEST_BODY_TOO_LARGE",
        `The request body exceeds the ${imageApiPolicy.maxMultipartBytes} byte limit`,
        413,
        "invalid_request_error",
      );
    }
    throw invalidRequest("The multipart form body is invalid", "INVALID_MULTIPART");
  }
  const allowed = new Set([
    "model", "prompt", "image", "image[]", "mask", "n", "quality",
    "size", "background", "output_format", "output_compression",
  ]);
  const entries = new Map<string, FormDataEntryValue[]>();
  for (const [key, value] of form.entries()) {
    if (!allowed.has(key)) throw invalidRequest(`Unsupported multipart field: ${key}`);
    entries.set(key, [...(entries.get(key) ?? []), value]);
  }
  if ((entries.get("image")?.length ?? 0) > 0 && (entries.get("image[]")?.length ?? 0) > 0) {
    throw invalidRequest("Use either image or image[], not both");
  }
  const imageValues = entries.get("image") ?? entries.get("image[]") ?? [];
  if (
    imageValues.length < 1
    || imageValues.length > imageApiPolicy.maxInputImages
    || imageValues.some((value) => typeof value === "string")
  ) {
    throw invalidRequest(
      `image must contain 1-${imageApiPolicy.maxInputImages} uploaded files`,
      "IMAGE_COUNT_INVALID",
    );
  }
  const maskValues = entries.get("mask") ?? [];
  if (maskValues.length > 1 || maskValues.some((value) => typeof value === "string")) {
    throw invalidRequest("mask must contain at most one uploaded PNG file");
  }
  const rawScalars = {
    model: uniqueScalar(entries, "model"),
    prompt: uniqueScalar(entries, "prompt"),
    n: uniqueScalar(entries, "n"),
    quality: uniqueScalar(entries, "quality"),
    size: uniqueScalar(entries, "size"),
    background: uniqueScalar(entries, "background"),
    output_format: uniqueScalar(entries, "output_format"),
    output_compression: uniqueScalar(entries, "output_compression"),
  };
  const parsed = imageEditScalarsSchema.safeParse(rawScalars);
  if (!parsed.success) {
    throw invalidRequest(
      parsed.error.issues.slice(0, 3)
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
    );
  }
  const totalBytes = [...imageValues, ...maskValues]
    .reduce((total, value) => total + (value as File).size, 0);
  if (totalBytes > imageApiPolicy.maxMultipartBytes) {
    throw new GatewayError(
      "REQUEST_BODY_TOO_LARGE",
      `Uploaded images exceed the ${imageApiPolicy.maxMultipartBytes} byte limit`,
      413,
      "invalid_request_error",
    );
  }
  const images = await Promise.all(
    imageValues.map(async (value, index) => await validateImageFile(value as File, {
      field: `image[${index}]`,
    })),
  );
  const mask = maskValues[0]
    ? await validateImageFile(maskValues[0] as File, { field: "mask", pngOnly: true })
    : undefined;
  return { fields: parsed.data, images, ...(mask ? { mask } : {}) };
}

const tokenDetailsSchema = z.strictObject({
  text_tokens: z.number().int().nonnegative(),
  image_tokens: z.number().int().nonnegative(),
});
const outputTokenDetailsSchema = z.strictObject({
  text_tokens: z.number().int().nonnegative().optional().default(0),
  image_tokens: z.number().int().nonnegative(),
});
const imageUsageSchema = z.strictObject({
  total_tokens: z.number().int().nonnegative(),
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  input_tokens_details: tokenDetailsSchema,
  output_tokens_details: outputTokenDetailsSchema.optional(),
});
const imageDataSchema = z.object({
  b64_json: z.string().min(1),
  revised_prompt: z.string().optional(),
  generation_id: z.string().optional(),
});
const imageResponseSchema = z.object({
  created: z.number().int().nonnegative(),
  data: z.array(imageDataSchema).min(1).max(imageApiPolicy.maxOutputImages),
  usage: imageUsageSchema,
  background: z.string().optional(),
  quality: z.string().optional(),
  size: z.string().optional(),
  output_format: z.enum(["png", "jpeg", "webp"]).optional(),
});

const imageUsageEnvelopeSchema = z.object({ usage: imageUsageSchema }).passthrough();

export class ImageProviderResultError extends GatewayError {
  constructor(
    code: string,
    message: string,
    public readonly usage: TokenUsage,
  ) {
    super(code, message, 502, "upstream_error");
    this.name = "ImageProviderResultError";
  }
}

export function validateBase64Image(value: string, allowGif: true): Promise<SupportedImageMime | "image/gif">;
export function validateBase64Image(value: string, allowGif?: false): Promise<SupportedImageMime>;
export async function validateBase64Image(value: string, allowGif = false) {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new GatewayError(
      "UPSTREAM_IMAGE_INVALID",
      "The upstream Provider returned invalid base64 image data",
      502,
      "upstream_error",
    );
  }
  const decodedBytes = Math.floor(value.length * 3 / 4)
    - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);
  if (decodedBytes < 1 || decodedBytes > imageApiPolicy.maxImageBytes) {
    throw new GatewayError(
      "UPSTREAM_IMAGE_SIZE_INVALID",
      "The upstream Provider returned an image outside the configured size limit",
      502,
      "upstream_error",
    );
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  const magic = allowGif ? detectedImageMime(bytes, true) : detectedImageMime(bytes);
  let mimeType: SupportedImageMime | "image/gif" | undefined;
  try {
    mimeType = magic ? await (allowGif ? decodedImageMime(bytes, true) : decodedImageMime(bytes)) : undefined;
  } catch {
    mimeType = undefined;
  }
  if (!mimeType || mimeType !== magic) {
    throw new GatewayError(
      "UPSTREAM_IMAGE_TYPE_INVALID",
      "The upstream Provider returned base64 data that is not a supported image",
      502,
      "upstream_error",
    );
  }
  return mimeType;
}

export function parseImageProviderUsage(
  value: unknown,
  input: { providerModel: string; upstreamRequestId?: string },
) {
  const usageEnvelope = imageUsageEnvelopeSchema.safeParse(value);
  if (!usageEnvelope.success) {
    throw new GatewayError(
      "UPSTREAM_RESPONSE_INVALID",
      "The upstream Provider returned an invalid Image response or missing reliable usage",
      502,
      "upstream_error",
    );
  }
  const source = usageEnvelope.data.usage;
  const outputTextTokens = source.output_tokens_details?.text_tokens ?? 0;
  const outputImageTokens = source.output_tokens_details?.image_tokens
    ?? source.output_tokens;
  if (
    source.input_tokens
      !== source.input_tokens_details.text_tokens + source.input_tokens_details.image_tokens
    || source.output_tokens
      !== outputTextTokens + outputImageTokens
    || source.total_tokens !== source.input_tokens + source.output_tokens
    || outputTextTokens !== 0
  ) {
    throw new GatewayError(
      "UPSTREAM_USAGE_INVALID",
      "The upstream Provider returned inconsistent Image Token usage",
      502,
      "upstream_error",
    );
  }
  return {
    inputTokens: source.input_tokens,
    outputTokens: source.output_tokens,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    inputTokenSemantics: "fresh",
    inputTextTokens: source.input_tokens_details.text_tokens,
    inputImageTokens: source.input_tokens_details.image_tokens,
    outputTextTokens,
    outputImageTokens,
    providerModel: input.providerModel,
    upstreamRequestId: input.upstreamRequestId,
  } satisfies TokenUsage;
}

export async function parseImageProviderResponse(
  value: unknown,
  input: { providerModel: string; upstreamRequestId?: string },
) {
  const usage = parseImageProviderUsage(value, input);
  const parsed = imageResponseSchema.safeParse(value);
  if (!parsed.success) {
    const data = value && typeof value === "object"
      ? (value as { data?: unknown }).data
      : undefined;
    throw new ImageProviderResultError(
      Array.isArray(data) && data.length === 0
        ? "UPSTREAM_IMAGE_RESULT_INVALID"
        : "UPSTREAM_RESPONSE_INVALID",
      Array.isArray(data) && data.length === 0
        ? "The upstream Provider returned no image result"
        : "The upstream Provider returned an invalid Image response",
      usage,
    );
  }
  let imageFormats: Array<"image/png" | "image/jpeg" | "image/webp">;
  try {
    imageFormats = await Promise.all(parsed.data.data.map(async (item) =>
      await validateBase64Image(item.b64_json)));
  } catch (error) {
    if (error instanceof GatewayError) {
      throw new ImageProviderResultError(error.code, error.message, usage);
    }
    throw error;
  }
  return { body: parsed.data, usage, imageFormats };
}
