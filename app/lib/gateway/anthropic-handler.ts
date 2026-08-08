import type {
  Message,
  MessageCountTokensParams,
  MessageCreateParamsNonStreaming,
  MessageCreateParamsStreaming,
} from "@anthropic-ai/sdk/resources/messages";
import {
  finalizeKnownUsage,
  finalizeProviderFailure,
  finalizeUnknownUsage,
} from "./lifecycle";
import { gatewayErrorResponse, GatewayError, toGatewayError } from "./errors";
import { prepareGatewayRequest, preparationErrorResponse } from "./prepare";
import {
  createAnthropicProviderClient,
  toProviderGatewayError,
} from "./provider-clients";
import {
  anthropicCountTokensSchema,
  anthropicMessageSchema,
} from "./protocols";
import {
  estimateJsonTokens,
  parseGatewayJson,
  readIdempotencyKey,
} from "./request-body";
import { markGatewayRequestStreaming } from "./repository";
import {
  applyAnthropicStreamEvent,
  emptyTokenUsage,
  hasBillableTokens,
  parseAnthropicResponse,
} from "./usage";
import { authenticateGatewayRequest } from "./auth";
import { resolveBillableModel } from "../models/resolver";

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

function anthropicStreamError(error: GatewayError, requestId: string) {
  return encoder.encode(
    `event: error\ndata: ${JSON.stringify({
      type: "error",
      error: { type: error.type, message: error.message, code: error.code },
      request_id: requestId,
    })}\n\n`,
  );
}

async function prepareMessage(request: Request) {
  const body = await parseGatewayJson(request, anthropicMessageSchema);
  const result = await prepareGatewayRequest({
    headers: request.headers,
    requiredScope: "messages:create",
    protocol: "anthropic",
    requestedModel: body.model,
    isStreaming: body.stream,
    idempotencyKey: readIdempotencyKey(request.headers),
    estimatedInputTokens: estimateJsonTokens({
      messages: body.messages,
      system: body.system,
      tools: body.tools,
    }),
    requestedMaxOutputTokens: body.max_tokens,
  });
  return { body, result };
}

async function handleNonStreamingMessage(
  request: Request,
  prepared: Extract<
    Awaited<ReturnType<typeof prepareGatewayRequest>>,
    { kind: "ready" }
  >["value"],
  body: Awaited<ReturnType<typeof parseGatewayJson<typeof anthropicMessageSchema>>>,
) {
  const startedAt = Date.now();
  let client: ReturnType<typeof createAnthropicProviderClient>;
  try {
    client = createAnthropicProviderClient(prepared.resolved);
  } catch (error) {
    await finalizeKnownUsage({
      requestId: prepared.requestId,
      usage: emptyTokenUsage("fresh"),
      outcome: "failed",
      httpStatus: toGatewayError(error).status,
      errorCode: toGatewayError(error).code,
      errorMessage: toGatewayError(error).message,
      startedAt,
    });
    return gatewayErrorResponse(error, prepared.requestId);
  }
  const upstreamBody = {
    ...body,
    model: prepared.resolved.model.upstreamModel,
    max_tokens: prepared.effectiveMaxOutputTokens,
    stream: false,
  } as unknown as MessageCreateParamsNonStreaming;

  let response: Message;
  try {
    response = await client.messages.create(upstreamBody, {
      signal: request.signal,
    });
  } catch (error) {
    try {
      const mapped = await finalizeProviderFailure({
        requestId: prepared.requestId,
        protocol: "anthropic",
        error,
        startedAt,
        cancelled: request.signal.aborted,
      });
      return gatewayErrorResponse(mapped, prepared.requestId);
    } catch (settlementError) {
      return gatewayErrorResponse(settlementError, prepared.requestId);
    }
  }

  const usage = parseAnthropicResponse(response);
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
        stop_reason: response.stop_reason,
      },
    });
  } catch (error) {
    return gatewayErrorResponse(error, prepared.requestId);
  }
  return Response.json(response, {
    headers: responseHeaders(prepared.requestId),
  });
}

async function handleStreamingMessage(
  request: Request,
  prepared: Extract<
    Awaited<ReturnType<typeof prepareGatewayRequest>>,
    { kind: "ready" }
  >["value"],
  body: Awaited<ReturnType<typeof parseGatewayJson<typeof anthropicMessageSchema>>>,
) {
  const startedAt = Date.now();
  let client: ReturnType<typeof createAnthropicProviderClient>;
  try {
    client = createAnthropicProviderClient(prepared.resolved);
    await markGatewayRequestStreaming(prepared.requestId);
  } catch {
    await finalizeKnownUsage({
      requestId: prepared.requestId,
      usage: emptyTokenUsage("fresh"),
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
    model: prepared.resolved.model.upstreamModel,
    max_tokens: prepared.effectiveMaxOutputTokens,
    stream: true,
  } as unknown as MessageCreateParamsStreaming;
  const abortController = new AbortController();
  let downstreamCancelled = false;
  let upstreamStream: ReturnType<typeof client.messages.stream> | undefined;
  const abort = () => abortController.abort();
  request.signal.addEventListener("abort", abort, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let usage = emptyTokenUsage("fresh");
      let firstTokenAt: number | undefined;
      let streamError: unknown;
      try {
        upstreamStream = client.messages.stream(upstreamBody, {
          signal: abortController.signal,
        });
        for await (const event of upstreamStream) {
          usage = applyAnthropicStreamEvent(usage, event);
          if (event.type === "content_block_delta" && firstTokenAt === undefined) {
            firstTokenAt = Date.now();
          }
          if (!downstreamCancelled) {
            controller.enqueue(
              encoder.encode(
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
              ),
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
            protocol: "anthropic",
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
        if (finalError) controller.enqueue(anthropicStreamError(finalError, prepared.requestId));
        controller.close();
      }
    },
    cancel() {
      downstreamCancelled = true;
      abortController.abort();
      upstreamStream?.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: responseHeaders(prepared.requestId, true),
  });
}

export async function handleAnthropicMessages(request: Request) {
  try {
    const { body, result } = await prepareMessage(request);
    if (result.kind !== "ready") return preparationErrorResponse(result);
    return body.stream
      ? await handleStreamingMessage(request, result.value, body)
      : await handleNonStreamingMessage(request, result.value, body);
  } catch (error) {
    return gatewayErrorResponse(error);
  }
}

export async function handleAnthropicCountTokens(request: Request) {
  try {
    const body = await parseGatewayJson(request, anthropicCountTokensSchema);
    const principal = await authenticateGatewayRequest(
      request.headers,
      "messages:create",
    );
    const resolved = await resolveBillableModel({
      platformUserId: principal.platformUserId,
      requestedModel: body.model,
      protocol: "anthropic",
    });
    const client = createAnthropicProviderClient(resolved);
    const response = await client.messages.countTokens(
      {
        ...body,
        model: resolved.model.upstreamModel,
      } as unknown as MessageCountTokensParams,
      { signal: request.signal },
    );
    return Response.json(response, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return gatewayErrorResponse(toProviderGatewayError(error));
  }
}
