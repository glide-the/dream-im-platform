// [Sync] 2026-10-12: preserve reported Images usage on cancellation and prevent a late successful image response.
// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] Authenticated public generation/edit requests, Image-capable models, and Provider responses.
// [Output] Settled OpenAI-compatible base64 Image responses or safe request-correlated errors.
// [Pos] Images Gateway orchestration; prompts and image bodies bypass text adapters and payload storage.
// [Sync] 2026-10-09: settle reliable usage even when an invalid Image result is withheld.
// [Sync] 2026-10-09: count an optional edit mask in the conservative input-image reservation.

import { estimateImageReservation } from "../billing/money";
import { imageApiCapabilityAvailable } from "../db/image-api-capability";
import { resolveBillableModel, type ResolvedBillableModel } from "../models/resolver";
import { withPlatformClient } from "../platform-db";
import { authenticateGatewayRequest, type GatewayPrincipal } from "./auth";
import { GatewayError, gatewayErrorResponse, toGatewayError } from "./errors";
import {
  imagePromptTokenReservation,
  imageTokenReservation,
} from "./image-policy";
import {
  parseImageEditRequest,
  parseImageGenerationRequest,
  parseImageProviderResponse,
  ImageProviderResultError,
  type ImageEditRequest,
  type ImageGenerationRequest,
  type ValidatedImageFile,
} from "./image-protocols";
import {
  ImageProviderHttpError,
  sendImageProviderRequest,
} from "./image-transport";
import { finalizeKnownUsage, finalizeProviderFailure } from "./lifecycle";
import { minimumGatewayReserveMicrousd, preparationErrorResponse } from "./prepare";
import { ProviderHttpError } from "./provider-transport";
import { beginGatewayRequest } from "./repository";
import { readIdempotencyKey } from "./request-body";
import { BodyLimitExceededError, readLimitedBody } from "./read-limited-body";
import { imageApiPolicy } from "../../../config/image-api-policy";
import { createHash } from "node:crypto";
import { imageTurnContext } from "./image-turn-receipts";
import { imageCallIdDto, imageReferenceUriDto } from "../dream/imageTurnDto";
import { operationInputDigest } from "../dream/receipts";
import { z } from "zod";

async function dreamImageExecution(request: Request, principal: GatewayPrincipal, model: string, prompt: string, files: readonly ValidatedImageFile[] = []) {
  // Independent fixed-key/OAuth Images clients retain their existing protocol.
  if (principal.runtimeIdentity?.purpose !== "gateway-cli") return undefined;
  const context = imageTurnContext(principal, request.headers.get("x-ink-image-turn-key"));
  const selectionId = imageCallIdDto.safeParse(request.headers.get("x-ink-image-selection-call-id"));
  const callId = imageCallIdDto.safeParse(request.headers.get("x-ink-image-tool-call-id"));
  let references: string[];
  try { references = z.array(imageReferenceUriDto).max(imageApiPolicy.maxInputImages).parse(JSON.parse(request.headers.get("x-ink-image-reference-uris") ?? "")); }
  catch { throw new GatewayError("IMAGE_TURN_SOURCE_MISMATCH", "The current image references are missing or invalid", 409, "invalid_request_error"); }
  if (!selectionId.success || !callId.success || references.length !== files.length || new Set(references).size !== references.length) {
    throw new GatewayError("IMAGE_TURN_SOURCE_MISMATCH", "The Images request has no matching conversation tool call", 409, "invalid_request_error");
  }
  return { context, claim: { operation: files.length ? "image_gen_edit" as const : "image_gen_generate" as const,
    selected_model: model, selection_call_id: selectionId.data }, source: { callId: callId.data,
    argumentsSha256: operationInputDigest({ prompt, reference_images: references }),
    selectionArgumentsSha256: operationInputDigest({ operation: files.length ? "image_gen_edit" : "image_gen_generate", prompt, reference_images: references }),
    materialSha256: await Promise.all(files.map(async file => createHash("sha256").update(new Uint8Array(await file.file.arrayBuffer())).digest("hex"))) } };
}

type ImageOperation = "images.generations" | "images.edits";

function optionalMinimum(a?: number, b?: number) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

async function requireImageCapability() {
  const available = await withPlatformClient(async (client) =>
    await imageApiCapabilityAvailable(client));
  if (!available) {
    throw new GatewayError(
      "IMAGE_API_SCHEMA_UNAVAILABLE",
      "The Images API database capability is unavailable",
      503,
      "configuration_error",
    );
  }
}

function responseRequestId(response: Response) {
  return response.headers.get("x-codex-imagegen-request-id")
    ?? response.headers.get("request-id")
    ?? response.headers.get("x-request-id")
    ?? response.headers.get("openai-request-id")
    ?? undefined;
}

async function readBoundedJson(response: Response) {
  let bytes: Uint8Array;
  try {
    bytes = await readLimitedBody({
      body: response.body,
      declaredLength: response.headers.get("content-length"),
      maxBytes: imageApiPolicy.maxResponseBytes,
    });
  } catch (error) {
    if (!(error instanceof BodyLimitExceededError)) throw error;
    throw new GatewayError(
      "UPSTREAM_RESPONSE_TOO_LARGE",
      "The upstream Image response exceeds the configured byte limit",
      502,
      "upstream_error",
    );
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new GatewayError(
      "UPSTREAM_RESPONSE_INVALID",
      "The upstream Provider returned invalid JSON",
      502,
      "upstream_error",
    );
  }
}

function ensureImagePricing(
  resolved: ResolvedBillableModel,
  inputImageCount: number,
) {
  if (resolved.pricing.imageOutputPriceMicrousdPerMillion === undefined) {
    throw new GatewayError(
      "IMAGE_OUTPUT_PRICING_UNAVAILABLE",
      "The selected Image model has no active image-output Token price",
      503,
      "configuration_error",
    );
  }
  if (
    inputImageCount > 0
    && resolved.pricing.imageInputPriceMicrousdPerMillion === undefined
  ) {
    throw new GatewayError(
      "IMAGE_INPUT_PRICING_UNAVAILABLE",
      "The selected Image model has no active image-input Token price",
      503,
      "configuration_error",
    );
  }
}

function generationProviderBody(
  request: ImageGenerationRequest,
  resolved: ResolvedBillableModel,
) {
  const body = { ...request, model: resolved.model.upstreamModel };
  if (
    resolved.provider.adapterKind === "codex"
    && (body.output_format !== undefined
      || body.output_compression !== undefined
      || body.moderation !== undefined)
  ) {
    throw new GatewayError(
      "CODEX_IMAGE_OPTION_UNSUPPORTED",
      "Codex Images does not support output_format, output_compression, or moderation",
      400,
      "invalid_request_error",
    );
  }
  if (resolved.provider.adapterKind === "codex") {
    const {
      output_format: _outputFormat,
      output_compression: _outputCompression,
      moderation: _moderation,
      ...codexBody
    } = body;
    return codexBody;
  }
  return body;
}

function fileExtension(mimeType: ValidatedImageFile["mimeType"]) {
  return mimeType === "image/png" ? "png" : mimeType === "image/jpeg" ? "jpg" : "webp";
}

async function neutralFile(input: ValidatedImageFile, name: string) {
  return new File(
    [await input.file.arrayBuffer()],
    `${name}.${fileExtension(input.mimeType)}`,
    { type: input.mimeType },
  );
}

async function editProviderBody(
  request: ImageEditRequest,
  resolved: ResolvedBillableModel,
) {
  if (resolved.provider.adapterKind === "codex") {
    if (
      request.mask
      || request.fields.output_format !== undefined
      || request.fields.output_compression !== undefined
    ) {
      throw new GatewayError(
        "CODEX_IMAGE_OPTION_UNSUPPORTED",
        "Codex Images does not support mask, output_format, or output_compression",
        400,
        "invalid_request_error",
      );
    }
    const images = await Promise.all(request.images.map(async (image) => ({
      image_url: `data:${image.mimeType};base64,${Buffer.from(
        await image.file.arrayBuffer(),
      ).toString("base64")}`,
    })));
    const { output_format: _format, output_compression: _compression, ...fields } = request.fields;
    return { ...fields, model: resolved.model.upstreamModel, images };
  }

  const form = new FormData();
  form.set("model", resolved.model.upstreamModel);
  form.set("prompt", request.fields.prompt);
  for (const name of ["n", "quality", "size", "background", "output_format", "output_compression"] as const) {
    const value = request.fields[name];
    if (value !== undefined) form.set(name, String(value));
  }
  const imageField = request.images.length === 1 ? "image" : "image[]";
  for (const [index, image] of request.images.entries()) {
    form.append(imageField, await neutralFile(image, `image-${index + 1}`));
  }
  if (request.mask) form.set("mask", await neutralFile(request.mask, "mask"));
  return form;
}

async function reserveImageRequest(input: {
  request: Request;
  principal: GatewayPrincipal;
  resolved: ResolvedBillableModel;
  operation: ImageOperation;
  requestedModel: string;
  prompt: string;
  inputImageCount: number;
  outputImageCount: number;
  imageExecution?: Awaited<ReturnType<typeof dreamImageExecution>>;
}) {
  ensureImagePricing(input.resolved, input.inputImageCount);
  const estimatedInputTextTokens = imagePromptTokenReservation(input.prompt);
  const estimatedInputImageTokens = input.inputImageCount
    * (input.resolved.model.imageInputTokenReservePerImage ?? 0);
  const maxOutputImageTokens = input.outputImageCount
    * (input.resolved.model.imageOutputTokenReservePerImage ?? 0);
  const estimatedTokens = imageTokenReservation({
    prompt: input.prompt,
    inputImageCount: input.inputImageCount,
    outputImageCount: input.outputImageCount,
    inputTokenReservePerImage:
      input.resolved.model.imageInputTokenReservePerImage,
    outputTokenReservePerImage:
      input.resolved.model.imageOutputTokenReservePerImage,
  });
  const reservationMicrousd = estimateImageReservation({
    estimatedInputTextTokens,
    estimatedInputImageTokens,
    maxOutputImageTokens,
    pricing: input.resolved.pricing,
    minimumReserveMicrousd: minimumGatewayReserveMicrousd(),
  });
  return await beginGatewayRequest({
    principal: input.principal,
    imageExecution: input.imageExecution,
    resolved: input.resolved,
    requestedModel: input.requestedModel,
    protocol: "openai",
    operation: input.operation,
    isStreaming: false,
    idempotencyKey: readIdempotencyKey(input.request.headers),
    reservationMicrousd,
    estimatedTokens,
    requiredScope: "images:create",
    limits: {
      requestsPerMinute: input.resolved.limits.requestsPerMinute,
      dailyTokenLimit: optionalMinimum(
        input.resolved.limits.dailyTokenLimit,
        input.principal.dailyTokenLimit,
      ),
      monthlyTokenLimit: optionalMinimum(
        input.resolved.limits.monthlyTokenLimit,
        input.principal.monthlyTokenLimit,
      ),
    },
  });
}

async function executeImageRequest(input: {
  request: Request;
  principal: GatewayPrincipal;
  resolved: ResolvedBillableModel;
  operation: ImageOperation;
  requestedModel: string;
  prompt: string;
  inputImageCount: number;
  outputImageCount: number;
  providerBody: Record<string, unknown> | FormData;
  imageExecution?: Awaited<ReturnType<typeof dreamImageExecution>>;
}) {
  const reservation = await reserveImageRequest(input);
  if (reservation.kind !== "reserved") {
    return await preparationErrorResponse(reservation, "openai");
  }
  const startedAt = Date.now();
  let finalizationAttempted = false;
  let providerDispatched = false;
  let transport: Awaited<ReturnType<typeof sendImageProviderRequest>> | undefined;
  try {
    transport = await sendImageProviderRequest({
      resolved: input.resolved,
      operation: input.operation,
      body: input.providerBody,
      requestSignal: input.request.signal,
      gatewayRequestId: reservation.requestId,
      onDispatch: () => { providerDispatched = true; },
    });
    const upstreamRequestId = responseRequestId(transport.response);
    const providerBody = await readBoundedJson(transport.response);
    transport.cleanup();
    const parsed = await parseImageProviderResponse(providerBody, {
      providerModel: input.resolved.model.upstreamModel,
      upstreamRequestId,
    });
    const cancelled = input.request.signal.aborted;
    finalizationAttempted = true;
    await finalizeKnownUsage({
      requestId: reservation.requestId,
      usage: parsed.usage,
      outcome: cancelled ? "cancelled" : "succeeded",
      httpStatus: cancelled ? 499 : 200,
      ...(cancelled ? { errorCode: "CLIENT_CANCELLED", errorMessage: "The downstream client cancelled" } : {}),
      startedAt,
      requireFullTokenAllowanceCapture: true,
      responseSummary: {
        operation: input.operation,
        imageCount: parsed.body.data.length,
        imageFormats: parsed.imageFormats,
        imageSize: parsed.body.size ?? null,
        model: parsed.usage.providerModel,
        upstreamRequestId: parsed.usage.upstreamRequestId,
        usageKnown: true,
      },
    });
    if (input.request.signal.aborted) {
      return gatewayErrorResponse(new GatewayError("CLIENT_CANCELLED", "The downstream client cancelled", 499, "invalid_request_error"), reservation.requestId);
    }
    return Response.json(parsed.body, {
      status: 200,
      headers: {
        "cache-control": "no-store",
        "x-request-id": reservation.requestId,
      },
    });
  } catch (error) {
    transport?.cleanup();
    let mapped: GatewayError;
    if (finalizationAttempted) {
      mapped = toGatewayError(error);
    } else if (!providerDispatched) {
      mapped = input.request.signal.aborted
        ? new GatewayError(
            "CLIENT_CANCELLED",
            "The downstream client cancelled before Provider dispatch",
            499,
            "invalid_request_error",
          )
        : toGatewayError(error);
      await finalizeKnownUsage({
        requestId: reservation.requestId,
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          inputTokenSemantics: "fresh",
          inputTextTokens: 0,
          inputImageTokens: 0,
          outputTextTokens: 0,
          outputImageTokens: 0,
          providerModel: input.resolved.model.upstreamModel,
        },
        outcome: input.request.signal.aborted ? "cancelled" : "failed",
        httpStatus: mapped.status,
        errorCode: input.request.signal.aborted ? "CLIENT_CANCELLED" : mapped.code,
        errorMessage: input.request.signal.aborted
          ? "The downstream client cancelled before Provider dispatch"
          : mapped.message,
        startedAt,
        requireFullTokenAllowanceCapture: true,
        responseSummary: {
          operation: input.operation,
          providerDispatched: false,
          usageKnown: true,
        },
      });
    } else {
      const usage = error instanceof ImageProviderResultError
        ? error.usage
        : error instanceof ImageProviderHttpError
          ? error.usage
          : undefined;
      if (input.request.signal.aborted && usage !== undefined) {
        mapped = new GatewayError("CLIENT_CANCELLED", "The downstream client cancelled", 499, "invalid_request_error");
        finalizationAttempted = true;
        await finalizeKnownUsage({ requestId: reservation.requestId, usage,
          outcome: "cancelled", httpStatus: 499, errorCode: mapped.code,
          errorMessage: mapped.message, startedAt, requireFullTokenAllowanceCapture: true,
          responseSummary: { operation: input.operation, providerDispatched: true, usageKnown: true },
        });
      } else {
      mapped = await finalizeProviderFailure({
          requestId: reservation.requestId,
          protocol: "openai",
          error,
          usage,
          startedAt,
          cancelled: input.request.signal.aborted,
          requireFullTokenAllowanceCapture: true,
          responseSummary: {
            operation: input.operation,
            providerDispatched: true,
          },
        });
      }
    }
    const response = gatewayErrorResponse(mapped, reservation.requestId);
    if (error instanceof ProviderHttpError && error.requestId) {
      response.headers.set("x-upstream-request-id", error.requestId);
    }
    return response;
  }
}

export async function handleImageGeneration(request: Request) {
  try {
    const principal = await authenticateGatewayRequest(request.headers, "images:create");
    await requireImageCapability();
    const body = await parseImageGenerationRequest(request);
    const resolved = await resolveBillableModel({
      platformUserId: principal.platformUserId,
      requestedModel: body.model,
      protocol: "openai",
      requiredCapability: "image_generation",
    });
    const providerBody = generationProviderBody(body, resolved);
    return await executeImageRequest({
      request,
      principal,
      resolved,
      operation: "images.generations",
      requestedModel: body.model,
      prompt: body.prompt,
      inputImageCount: 0,
      outputImageCount: body.n,
      imageExecution: await dreamImageExecution(request, principal, body.model, body.prompt),
      providerBody,
    });
  } catch (error) {
    return gatewayErrorResponse(error);
  }
}

export async function handleImageEdit(request: Request) {
  try {
    const principal = await authenticateGatewayRequest(request.headers, "images:create");
    await requireImageCapability();
    const body = await parseImageEditRequest(request);
    const resolved = await resolveBillableModel({
      platformUserId: principal.platformUserId,
      requestedModel: body.fields.model,
      protocol: "openai",
      requiredCapability: "image_edit",
    });
    const providerBody = await editProviderBody(body, resolved);
    if (principal.runtimeIdentity?.purpose === "gateway-cli" && body.mask) throw new GatewayError("IMAGE_TURN_SOURCE_MISMATCH", "Conversation image tools do not accept an unbound mask", 409, "invalid_request_error");
    return await executeImageRequest({
      request,
      principal,
      resolved,
      operation: "images.edits",
      requestedModel: body.fields.model,
      prompt: body.fields.prompt,
      inputImageCount: body.images.length + (body.mask ? 1 : 0),
      outputImageCount: body.fields.n,
      imageExecution: await dreamImageExecution(request, principal, body.fields.model, body.fields.prompt, body.images),
      providerBody,
    });
  } catch (error) {
    return gatewayErrorResponse(error);
  }
}
