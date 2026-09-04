// [Input] Prepared billable request, product dialect, client cancellation, protocol body, and provider response.
// [Output] Adapted JSON/SSE response with payload capture, renewal snapshot, usage accounting, and settlement.
// [Pos] Core provider proxy lifecycle joining protocol adapters, transport, billing, and response persistence.
// [Sync] 2026-09-04: persist managed credential revision/renewal and adapt Responses JSON/SSE without replay.

import type { z } from "zod";
import { createHash } from "node:crypto";
import type { ResolvedBillableModel } from "../models/resolver";
import type { TokenUsage } from "../billing/types";
import { GatewayError, gatewayErrorResponse, toGatewayError } from "./errors";
import { finalizeKnownUsage, finalizeProviderFailure, finalizeUnknownUsage } from "./lifecycle";
import {
  completeGatewayStreamPayload,
  markGatewayPayloadCaptureFailure,
  recordGatewayJsonResponse,
  recordGatewayResponseEvent,
  safePayloadWrite,
  startGatewayResponsePayload,
} from "./payloads";
import { adaptProviderRequest, adaptProviderResponse, record, type GatewayProtocol } from "./protocol-adapters";
import { ProviderHttpError, sendProviderRequest } from "./provider-transport";
import { createProtocolStreamAdapter } from "./stream-adapters";
import { parseSseStream, serializeSse } from "./sse";
import { responseObjectFromEvent } from "./responses-adapter";
import {
  applyAnthropicStreamEvent,
  applyOpenAIChatStreamChunk,
  emptyTokenUsage,
  hasBillableTokens,
  parseAnthropicResponse,
  parseOpenAIChatResponse,
} from "./usage";
import { markGatewayRequestStreaming } from "./repository";
import { BoundedTaskQueue } from "./bounded-task-queue";

type JsonRecord = Record<string, unknown>;

export type ReadyGatewayRequest = {
  requestId: string;
  effectiveMaxOutputTokens: number;
  resolved: ResolvedBillableModel;
};

function responseHeaders(requestId: string, streaming = false) {
  return new Headers({
    "cache-control": streaming ? "no-cache, no-transform" : "no-store",
    "x-request-id": requestId,
    ...(streaming
      ? {
          "content-type": "text/event-stream; charset=utf-8",
          connection: "keep-alive",
          "x-accel-buffering": "no",
        }
      : { "content-type": "application/json; charset=utf-8" }),
  });
}

function publicErrorBody(protocol: GatewayProtocol, error: GatewayError, requestId: string) {
  return protocol === "anthropic"
    ? { type: "error", error: { type: error.type, message: error.message, code: error.code }, request_id: requestId }
    : { error: { type: error.type, code: error.code, message: error.message, request_id: requestId } };
}

function protocolErrorResponse(protocol: GatewayProtocol, error: unknown, requestId: string) {
  const mapped = toGatewayError(error);
  const headers = responseHeaders(requestId);
  if (mapped.retryable) headers.set("retry-after", "1");
  return Response.json(publicErrorBody(protocol, mapped, requestId), { status: mapped.status, headers });
}

export function gatewayProtocolErrorResponse(
  protocol: GatewayProtocol,
  error: unknown,
  requestId?: string,
) {
  if (requestId) return protocolErrorResponse(protocol, error, requestId);
  if (protocol === "openai") return gatewayErrorResponse(error);
  const mapped = toGatewayError(error);
  return Response.json(
    { type: "error", error: { type: mapped.type, message: mapped.message, code: mapped.code } },
    { status: mapped.status, headers: mapped.retryable ? { "retry-after": "1" } : undefined },
  );
}

function parseProviderJson(raw: string) {
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value)) throw new Error("not an object");
    return value as JsonRecord;
  } catch {
    throw new GatewayError("UPSTREAM_RESPONSE_INVALID", "The upstream provider returned invalid JSON", 502, "upstream_error");
  }
}

async function readProviderJsonResponse(
  transport: Awaited<ReturnType<typeof sendProviderRequest>>,
  adapterKind?: string,
) {
  const isResponsesAdapter = adapterKind === "codex" || adapterKind === "xai";
  if (!isResponsesAdapter || !transport.response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    return parseProviderJson(await transport.response.text());
  }
  if (!transport.response.body) {
    throw new GatewayError(
      "UPSTREAM_RESPONSE_INVALID",
      "The upstream provider returned an empty Responses stream",
      502,
      "upstream_error",
    );
  }
  let terminal: JsonRecord | undefined;
  for await (const event of parseSseStream(
    transport.response.body,
    transport.abort.signal,
    transport.abort.refreshStreamIdleTimeout,
  )) {
    if (event.data === "[DONE]") break;
    const value = parseProviderJson(event.data);
    terminal = responseObjectFromEvent(value) ?? terminal;
  }
  if (!terminal) {
    throw new GatewayError(
      "UPSTREAM_RESPONSE_INVALID",
      "The upstream Responses stream ended without a terminal response",
      502,
      "upstream_error",
    );
  }
  return terminal;
}

function outputUsage(protocol: GatewayProtocol, body: unknown) {
  return protocol === "anthropic" ? parseAnthropicResponse(body) : parseOpenAIChatResponse(body);
}

function emptyUsage(protocol: GatewayProtocol) {
  return emptyTokenUsage(protocol === "anthropic" ? "fresh" : "total_including_cache");
}

function applyOutputUsage(protocol: GatewayProtocol, current: TokenUsage, event: unknown) {
  return protocol === "anthropic"
    ? applyAnthropicStreamEvent(current, event)
    : applyOpenAIChatStreamChunk(current, event);
}

function responseRequestId(response: Response) {
  return response.headers.get("request-id")
    ?? response.headers.get("x-request-id")
    ?? response.headers.get("openai-request-id")
    ?? undefined;
}

function containsFirstToken(protocol: GatewayProtocol, event: JsonRecord) {
  if (protocol === "anthropic") {
    const delta = record(event.delta);
    return event.type === "content_block_delta" && ["text_delta", "thinking_delta", "input_json_delta"].includes(String(delta?.type));
  }
  return (Array.isArray(event.choices) ? event.choices : []).some((source) => {
    const delta = record(record(source)?.delta);
    return Boolean(delta?.content ?? delta?.reasoning_content ?? delta?.tool_calls);
  });
}

async function settleStream(input: {
  requestId: string;
  protocol: GatewayProtocol;
  usage: TokenUsage;
  startedAt: number;
  firstTokenAt?: number;
  outcome: "succeeded" | "failed" | "cancelled";
  error?: unknown;
}) {
  if (input.error) {
    return await finalizeProviderFailure({
      requestId: input.requestId,
      protocol: input.protocol,
      error: input.error,
      usage: input.usage,
      startedAt: input.startedAt,
      firstTokenAt: input.firstTokenAt,
      cancelled: input.outcome === "cancelled",
    });
  }
  if (hasBillableTokens(input.usage)) {
    await finalizeKnownUsage({
      requestId: input.requestId,
      usage: input.usage,
      outcome: input.outcome,
      httpStatus: input.outcome === "succeeded" ? 200 : undefined,
      startedAt: input.startedAt,
      firstTokenAt: input.firstTokenAt,
      responseSummary: { id: input.usage.upstreamRequestId, model: input.usage.providerModel },
    });
    return undefined;
  }
  await finalizeUnknownUsage({
    requestId: input.requestId,
    outcome: input.outcome === "cancelled" ? "cancelled" : "failed",
    errorCode: "UPSTREAM_USAGE_MISSING",
    errorMessage: "The upstream stream ended without reliable final usage",
    httpStatus: input.outcome === "cancelled" ? undefined : 502,
    startedAt: input.startedAt,
    firstTokenAt: input.firstTokenAt,
  });
  return new GatewayError("UPSTREAM_USAGE_MISSING", "The upstream stream ended without reliable final usage", 502, "upstream_error");
}

export async function proxyNonStreaming(input: {
  request: Request;
  externalProtocol: GatewayProtocol;
  prepared: ReadyGatewayRequest;
  body: JsonRecord;
}) {
  const startedAt = Date.now();
  const upstreamBody = adaptProviderRequest({
    externalProtocol: input.externalProtocol,
    providerProtocol: input.prepared.resolved.provider.protocol,
    providerAdapterKind: input.prepared.resolved.provider.adapterKind,
    body: { ...input.body, stream: false },
    model: input.prepared.resolved.model.upstreamModel,
    maxOutputTokens: input.prepared.effectiveMaxOutputTokens,
  });
  let transport: Awaited<ReturnType<typeof sendProviderRequest>>;
  try {
    transport = await sendProviderRequest({ resolved: input.prepared.resolved, body: upstreamBody, requestSignal: input.request.signal, requestHeaders: input.request.headers, requestUrl: input.request.url, gatewayRequestId: input.prepared.requestId, allowManagedCredentialRetry: true });
    const providerBody = await readProviderJsonResponse(
      transport,
      input.prepared.resolved.provider.adapterKind,
    );
    transport.abort.cleanup();
    const output = adaptProviderResponse({
      externalProtocol: input.externalProtocol,
      providerProtocol: input.prepared.resolved.provider.protocol,
      providerAdapterKind: input.prepared.resolved.provider.adapterKind,
      body: providerBody,
      requestedModel: input.body.model as string,
    });
    const usage = outputUsage(input.externalProtocol, output);
    const providerRequestId = responseRequestId(transport.response);
    if (usage && !usage.upstreamRequestId) usage.upstreamRequestId = providerRequestId;
    const headers = responseHeaders(input.prepared.requestId);
    if (!usage) {
      const error = new GatewayError("UPSTREAM_USAGE_MISSING", "The upstream response did not contain reliable billable usage", 502, "upstream_error");
      const errorBody = publicErrorBody(input.externalProtocol, error, input.prepared.requestId);
      await safePayloadWrite(recordGatewayJsonResponse({ requestId: input.prepared.requestId, status: 502, headers, body: errorBody, errorBody: providerBody }), input.prepared.requestId);
      await finalizeUnknownUsage({ requestId: input.prepared.requestId, outcome: "failed", errorCode: error.code, errorMessage: error.message, httpStatus: 502, startedAt });
      return protocolErrorResponse(input.externalProtocol, error, input.prepared.requestId);
    }
    await safePayloadWrite(recordGatewayJsonResponse({ requestId: input.prepared.requestId, status: 200, headers, body: output, providerRequestId: providerRequestId ?? usage.upstreamRequestId }), input.prepared.requestId);
    await finalizeKnownUsage({ requestId: input.prepared.requestId, usage, outcome: "succeeded", httpStatus: 200, startedAt, responseSummary: { id: usage.upstreamRequestId, model: usage.providerModel } });
    return Response.json(output, { status: 200, headers });
  } catch (error) {
    const mapped = await finalizeProviderFailure({ requestId: input.prepared.requestId, protocol: input.externalProtocol, error, startedAt, cancelled: input.request.signal.aborted });
    const headers = responseHeaders(input.prepared.requestId);
    const body = publicErrorBody(input.externalProtocol, mapped, input.prepared.requestId);
    await safePayloadWrite(recordGatewayJsonResponse({
      requestId: input.prepared.requestId,
      status: mapped.status,
      headers,
      body,
      providerRequestId: error instanceof ProviderHttpError ? error.requestId : undefined,
      errorBody: error instanceof ProviderHttpError ? error.responseBody : undefined,
    }), input.prepared.requestId);
    return protocolErrorResponse(input.externalProtocol, mapped, input.prepared.requestId);
  }
}

export async function proxyStreaming(input: {
  request: Request;
  externalProtocol: GatewayProtocol;
  prepared: ReadyGatewayRequest;
  body: JsonRecord;
}) {
  const startedAt = Date.now();
  const upstreamBody = adaptProviderRequest({
    externalProtocol: input.externalProtocol,
    providerProtocol: input.prepared.resolved.provider.protocol,
    providerAdapterKind: input.prepared.resolved.provider.adapterKind,
    body: { ...input.body, stream: true, ...(input.prepared.resolved.provider.protocol === "openai" ? { stream_options: { ...(record(input.body.stream_options) ?? {}), include_usage: true } } : {}) },
    model: input.prepared.resolved.model.upstreamModel,
    maxOutputTokens: input.prepared.effectiveMaxOutputTokens,
  });
  await markGatewayRequestStreaming(input.prepared.requestId);
  let transport: Awaited<ReturnType<typeof sendProviderRequest>>;
  try {
    transport = await sendProviderRequest({ resolved: input.prepared.resolved, body: upstreamBody, requestSignal: input.request.signal, requestHeaders: input.request.headers, requestUrl: input.request.url, gatewayRequestId: input.prepared.requestId });
  } catch (error) {
    const mapped = await finalizeProviderFailure({ requestId: input.prepared.requestId, protocol: input.externalProtocol, error, startedAt, cancelled: input.request.signal.aborted });
    const headers = responseHeaders(input.prepared.requestId);
    const body = publicErrorBody(input.externalProtocol, mapped, input.prepared.requestId);
    await safePayloadWrite(recordGatewayJsonResponse({ requestId: input.prepared.requestId, status: mapped.status, headers, body, providerRequestId: error instanceof ProviderHttpError ? error.requestId : undefined, errorBody: error instanceof ProviderHttpError ? error.responseBody : undefined }), input.prepared.requestId);
    return protocolErrorResponse(input.externalProtocol, mapped, input.prepared.requestId);
  }
  const upstream = transport.response;
  const upstreamHeaderRequestId = responseRequestId(upstream);
  if (!upstream.body || !upstream.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
    transport.abort.cleanup();
    const error = new GatewayError("UPSTREAM_STREAM_INVALID", "The upstream provider did not return an SSE stream", 502, "upstream_error");
    await finalizeProviderFailure({ requestId: input.prepared.requestId, protocol: input.externalProtocol, error, startedAt });
    return protocolErrorResponse(input.externalProtocol, error, input.prepared.requestId);
  }

  const headers = responseHeaders(input.prepared.requestId, true);
  let captureFailed = false;
  const captureQueue = new BoundedTaskQueue(32, async (error) => {
    captureFailed = true;
    await markGatewayPayloadCaptureFailure(input.prepared.requestId, error).catch(() => undefined);
  });
  await captureQueue.enqueue(() => startGatewayResponsePayload({ requestId: input.prepared.requestId, status: 200, headers }));
  transport.abort.refreshStreamIdleTimeout();
  const iterator = parseSseStream(
    upstream.body,
    transport.abort.signal,
    transport.abort.refreshStreamIdleTimeout,
  )[Symbol.asyncIterator]();
  const adapter = createProtocolStreamAdapter({
    externalProtocol: input.externalProtocol,
    providerProtocol: input.prepared.resolved.provider.protocol,
    providerAdapterKind: input.prepared.resolved.provider.adapterKind,
    requestedModel: String(input.body.model),
  });
  let usage = emptyUsage(input.externalProtocol);
  usage.upstreamRequestId = upstreamHeaderRequestId;
  let firstTokenAt: number | undefined;
  let sequence = 0;
  let terminal = false;
  let cancelled = false;
  const responseHash = createHash("sha256");
  let responseHashFinalized = false;

  const finishResponseHash = () => {
    if (responseHashFinalized) return undefined;
    responseHashFinalized = true;
    return responseHash.digest("hex");
  };

  const emit = async (controller: ReadableStreamDefaultController<Uint8Array>, data: JsonRecord | "[DONE]") => {
    const eventType = data === "[DONE]" ? "done" : input.externalProtocol === "anthropic" ? String(data.type ?? "message") : "message";
    const serialized = serializeSse({ protocol: input.externalProtocol, data, eventType });
    responseHash.update(serialized.rawEvent);
    controller.enqueue(new TextEncoder().encode(serialized.rawEvent));
    if (data !== "[DONE]") {
      usage = applyOutputUsage(input.externalProtocol, usage, data);
      if (firstTokenAt === undefined && containsFirstToken(input.externalProtocol, data)) firstTokenAt = Date.now();
    }
    const currentSequence = sequence++;
    await captureQueue.enqueue(() => recordGatewayResponseEvent({ requestId: input.prepared.requestId, sequence: currentSequence, eventType: serialized.eventType, rawData: serialized.rawData, rawEvent: serialized.rawEvent, startedAt }));
  };

  const finish = async (controller: ReadableStreamDefaultController<Uint8Array>) => {
    if (terminal) return;
    terminal = true;
    for (const output of adapter.finish()) await emit(controller, output);
    const finalError = await settleStream({ requestId: input.prepared.requestId, protocol: input.externalProtocol, usage, startedAt, firstTokenAt, outcome: cancelled ? "cancelled" : "succeeded" });
    if (finalError && !cancelled) await emit(controller, publicErrorBody(input.externalProtocol, finalError, input.prepared.requestId) as JsonRecord);
    else if (input.externalProtocol === "openai" && !cancelled) await emit(controller, "[DONE]");
    transport.abort.cleanup();
    await captureQueue.enqueue(() => completeGatewayStreamPayload({ requestId: input.prepared.requestId, status: cancelled ? "cancelled" : finalError ? "failed" : "complete", providerRequestId: upstreamHeaderRequestId ?? usage.upstreamRequestId, sha256: finishResponseHash(), captureError: captureFailed ? "One or more stream payload writes failed" : undefined }));
    await captureQueue.drain();
    if (!cancelled) controller.close();
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (terminal) return;
      try {
        while (!terminal) {
          const next = await iterator.next();
          if (next.done || next.value.data === "[DONE]") {
            if (!next.done) await iterator.return?.(undefined);
            await finish(controller);
            return;
          }
          let providerEvent: JsonRecord;
          try { providerEvent = parseProviderJson(next.value.data); }
          catch (error) { throw new GatewayError("UPSTREAM_SSE_INVALID", "The upstream provider returned an invalid SSE event", 502, "upstream_error"); }
          const outputs = adapter.push(next.value.event, providerEvent);
          for (const output of outputs) await emit(controller, output);
          if (outputs.length) return;
        }
      } catch (error) {
        terminal = true;
        const mapped = await settleStream({ requestId: input.prepared.requestId, protocol: input.externalProtocol, usage, startedAt, firstTokenAt, outcome: cancelled || input.request.signal.aborted ? "cancelled" : "failed", error });
        if (!cancelled) await emit(controller, publicErrorBody(input.externalProtocol, mapped ?? toGatewayError(error), input.prepared.requestId) as JsonRecord);
        transport.abort.cleanup();
        await captureQueue.enqueue(() => completeGatewayStreamPayload({ requestId: input.prepared.requestId, status: cancelled ? "cancelled" : "interrupted", providerRequestId: upstreamHeaderRequestId ?? usage.upstreamRequestId, sha256: finishResponseHash(), captureError: captureFailed ? "One or more stream payload writes failed" : undefined }));
        await captureQueue.drain();
        if (!cancelled) controller.close();
      }
    },
    async cancel() {
      if (terminal) return;
      terminal = true;
      cancelled = true;
      transport.abort.abort();
      await iterator.return?.(undefined);
      await settleStream({ requestId: input.prepared.requestId, protocol: input.externalProtocol, usage, startedAt, firstTokenAt, outcome: "cancelled", error: new DOMException("Downstream client cancelled", "AbortError") });
      await captureQueue.enqueue(() => completeGatewayStreamPayload({ requestId: input.prepared.requestId, status: "cancelled", providerRequestId: upstreamHeaderRequestId ?? usage.upstreamRequestId, sha256: finishResponseHash(), captureError: captureFailed ? "One or more stream payload writes failed" : undefined }));
      await captureQueue.drain();
      transport.abort.cleanup();
    },
  });
  return new Response(stream, { status: 200, headers });
}
