import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from "openai/resources/chat/completions";
import { finalizeKnownUsage, finalizeProviderFailure, finalizeUnknownUsage } from "./lifecycle";
import { gatewayErrorResponse, GatewayError, toGatewayError } from "./errors";
import { prepareGatewayRequest, preparationErrorResponse } from "./prepare";
import { createOpenAIProviderClient } from "./provider-clients";
import {
  openAIChatCompletionSchema,
  type OpenAIChatCompletionBody,
} from "./protocols";
import {
  estimateJsonTokens,
  parseGatewayJson,
  readIdempotencyKey,
} from "./request-body";
import { markGatewayRequestStreaming } from "./repository";
import {
  applyOpenAIChatStreamChunk,
  emptyTokenUsage,
  hasBillableTokens,
  parseOpenAIChatResponse,
} from "./usage";

const encoder = new TextEncoder();

function responseHeaders(requestId: string, streaming = false) {
  return {
    "cache-control": "no-store",
    "x-request-id": requestId,
    ...(streaming
      ? {
          "content-type": "text/event-stream; charset=utf-8",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        }
      : {}),
  };
}

function openAIStreamError(error: GatewayError, requestId: string) {
  return encoder.encode(
    `data: ${JSON.stringify({
      error: {
        type: error.type,
        code: error.code,
        message: error.message,
        request_id: requestId,
      },
    })}\n\n`,
  );
}

function openAIOutputLimitBody(
  body: OpenAIChatCompletionBody,
  effectiveMaxOutputTokens: number,
  providerConfig: Record<string, unknown>,
) {
  if (body.max_tokens != null) {
    return { max_tokens: effectiveMaxOutputTokens };
  }
  if (body.max_completion_tokens != null) {
    return { max_completion_tokens: effectiveMaxOutputTokens };
  }
  return providerConfig.outputTokenParam === "max_tokens"
    ? { max_tokens: effectiveMaxOutputTokens }
    : { max_completion_tokens: effectiveMaxOutputTokens };
}

async function prepareChatCompletion(request: Request) {
  const body = await parseGatewayJson(request, openAIChatCompletionSchema);
  const requestedMaxOutputTokens =
    body.max_completion_tokens ?? body.max_tokens ?? undefined;
  const result = await prepareGatewayRequest({
    headers: request.headers,
    requiredScope: "chat:create",
    protocol: "openai",
    requestedModel: body.model,
    isStreaming: body.stream,
    idempotencyKey: readIdempotencyKey(request.headers),
    estimatedInputTokens: estimateJsonTokens({
      messages: body.messages,
      tools: body.tools,
      response_format: body.response_format,
    }),
    requestedMaxOutputTokens,
    outputChoices: body.n ?? 1,
  });
  return { body, result };
}

type ReadyRequest = Extract<
  Awaited<ReturnType<typeof prepareGatewayRequest>>,
  { kind: "ready" }
>["value"];

async function handleNonStreamingChat(
  request: Request,
  prepared: ReadyRequest,
  body: OpenAIChatCompletionBody,
) {
  const startedAt = Date.now();
  let client: ReturnType<typeof createOpenAIProviderClient>;
  try {
    client = createOpenAIProviderClient(prepared.resolved);
  } catch (error) {
    const mapped = toGatewayError(error);
    await finalizeKnownUsage({
      requestId: prepared.requestId,
      usage: emptyTokenUsage("total_including_cache"),
      outcome: "failed",
      httpStatus: mapped.status,
      errorCode: mapped.code,
      errorMessage: mapped.message,
      startedAt,
    });
    return gatewayErrorResponse(mapped, prepared.requestId);
  }
  const upstreamBody = {
    ...body,
    ...openAIOutputLimitBody(
      body,
      prepared.effectiveMaxOutputTokens,
      prepared.resolved.provider.config,
    ),
    model: prepared.resolved.model.upstreamModel,
    stream: false,
  } as unknown as ChatCompletionCreateParamsNonStreaming;

  let response: ChatCompletion;
  try {
    response = await client.chat.completions.create(upstreamBody, {
      signal: request.signal,
    });
  } catch (error) {
    try {
      const mapped = await finalizeProviderFailure({
        requestId: prepared.requestId,
        protocol: "openai",
        error,
        startedAt,
        cancelled: request.signal.aborted,
      });
      return gatewayErrorResponse(mapped, prepared.requestId);
    } catch (settlementError) {
      return gatewayErrorResponse(settlementError, prepared.requestId);
    }
  }

  const usage = parseOpenAIChatResponse(response);
  if (!usage) {
    await finalizeUnknownUsage({
      requestId: prepared.requestId,
      outcome: "failed",
      errorCode: "UPSTREAM_USAGE_MISSING",
      errorMessage: "The upstream response did not contain billable usage",
      httpStatus: 502,
      startedAt,
    });
    return gatewayErrorResponse(
      new GatewayError(
        "UPSTREAM_USAGE_MISSING",
        "The upstream response did not contain billable usage",
        502,
        "upstream_error",
      ),
      prepared.requestId,
    );
  }
  try {
    await finalizeKnownUsage({
      requestId: prepared.requestId,
      usage,
      outcome: "succeeded",
      httpStatus: 200,
      startedAt,
      responseSummary: {
        id: response.id,
        model: response.model,
        finish_reasons: response.choices.map((choice) => choice.finish_reason),
      },
    });
  } catch (error) {
    return gatewayErrorResponse(error, prepared.requestId);
  }
  return Response.json(response, {
    headers: responseHeaders(prepared.requestId),
  });
}

async function handleStreamingChat(
  request: Request,
  prepared: ReadyRequest,
  body: OpenAIChatCompletionBody,
) {
  const startedAt = Date.now();
  let client: ReturnType<typeof createOpenAIProviderClient>;
  try {
    client = createOpenAIProviderClient(prepared.resolved);
    await markGatewayRequestStreaming(prepared.requestId);
  } catch {
    await finalizeKnownUsage({
      requestId: prepared.requestId,
      usage: emptyTokenUsage("total_including_cache"),
      outcome: "failed",
      httpStatus: 503,
      errorCode: "GATEWAY_STREAM_INITIALIZATION_FAILED",
      errorMessage: "The gateway could not initialize request streaming",
      startedAt,
    });
    return gatewayErrorResponse(
      new GatewayError(
        "GATEWAY_STREAM_INITIALIZATION_FAILED",
        "The gateway could not initialize request streaming",
        503,
        "internal_error",
        true,
      ),
      prepared.requestId,
    );
  }

  const upstreamBody = {
    ...body,
    ...openAIOutputLimitBody(
      body,
      prepared.effectiveMaxOutputTokens,
      prepared.resolved.provider.config,
    ),
    model: prepared.resolved.model.upstreamModel,
    stream: true,
    stream_options: { include_usage: true },
  } as unknown as ChatCompletionCreateParamsStreaming;
  const abortController = new AbortController();
  let downstreamCancelled = false;
  let upstreamController: AbortController | undefined;
  const abort = () => abortController.abort();
  request.signal.addEventListener("abort", abort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let usage = emptyTokenUsage("total_including_cache");
      let firstTokenAt: number | undefined;
      let streamError: unknown;
      try {
        const upstream = await client.chat.completions.create(upstreamBody, {
          signal: abortController.signal,
        });
        upstreamController = upstream.controller;
        for await (const chunk of upstream) {
          usage = applyOpenAIChatStreamChunk(usage, chunk);
          if (
            firstTokenAt === undefined &&
            chunk.choices.some((choice) => choice.delta.content != null)
          ) {
            firstTokenAt = Date.now();
          }
          if (!downstreamCancelled) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`),
            );
          }
        }
      } catch (error) {
        streamError = error;
      }

      let finalError: GatewayError | undefined;
      try {
        if (streamError) {
          finalError = await finalizeProviderFailure({
            requestId: prepared.requestId,
            protocol: "openai",
            error: streamError,
            usage,
            startedAt,
            firstTokenAt,
            cancelled: downstreamCancelled || request.signal.aborted,
          });
        } else if (hasBillableTokens(usage)) {
          await finalizeKnownUsage({
            requestId: prepared.requestId,
            usage,
            outcome: downstreamCancelled ? "cancelled" : "succeeded",
            httpStatus: downstreamCancelled ? undefined : 200,
            startedAt,
            firstTokenAt,
            responseSummary: {
              id: usage.upstreamRequestId,
              model: usage.providerModel,
            },
          });
        } else {
          await finalizeUnknownUsage({
            requestId: prepared.requestId,
            outcome: downstreamCancelled ? "cancelled" : "failed",
            errorCode: "UPSTREAM_USAGE_MISSING",
            errorMessage: "The upstream stream ended without final usage",
            httpStatus: 502,
            startedAt,
            firstTokenAt,
          });
          finalError = new GatewayError(
            "UPSTREAM_USAGE_MISSING",
            "The upstream stream ended without final usage",
            502,
            "upstream_error",
          );
        }
      } catch (error) {
        finalError = toGatewayError(error);
      } finally {
        request.signal.removeEventListener("abort", abort);
      }

      if (!downstreamCancelled) {
        if (finalError) {
          controller.enqueue(openAIStreamError(finalError, prepared.requestId));
        } else {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
        controller.close();
      }
    },
    cancel() {
      downstreamCancelled = true;
      abortController.abort();
      upstreamController?.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: responseHeaders(prepared.requestId, true),
  });
}

export async function handleOpenAIChatCompletions(request: Request) {
  try {
    const { body, result } = await prepareChatCompletion(request);
    if (result.kind !== "ready") return preparationErrorResponse(result);
    return body.stream
      ? await handleStreamingChat(request, result.value, body)
      : await handleNonStreamingChat(request, result.value, body);
  } catch (error) {
    return gatewayErrorResponse(error);
  }
}
