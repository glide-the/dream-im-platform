// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] A claimed native image turn, the frozen AI Provider and original CLI Messages request.
// [Output] Bounded Responses image execution projected into Messages server-tool blocks and safe result facts.
// [Pos] Image-only branch of the original public Messages handler; no Images fallback, route retry or raw capture.
// [Sync] 2026-10-10: keep successful image delivery independent of unknown complete billing usage.
// [Sync] 2026-10-11: preserve observed Codex tool shape and validate all native stream call identities.
// [Sync] 2026-10-11: settle validated official ResponseUsage once, preserving counts on native failures and cancellation.
import type { PreparedGatewayRequest } from "./prepare";
import { adaptProviderRequest, record } from "./protocol-adapters";
import { sendProviderRequest } from "./provider-transport";
import { parseResponsesImageResult, parseResponsesReportedUsage } from "./responses-image-protocol";
import { ResponsesStreamResponseState } from "./responses-adapter";
import { parseSseStream, serializeSse } from "./sse";
import { imageApiPolicy } from "../../../config/image-api-policy";
import { readLimitedBody } from "./read-limited-body";
import { GatewayError, toGatewayError } from "./errors";
import { finalizeKnownUsage, finalizeProviderFailure, finalizeUnknownUsage } from "./lifecycle";
import { emptyTokenUsage } from "./usage";
import { markGatewayRequestStreaming } from "./repository";
import { withPlatformTransaction } from "../platform-db";
import { recordNativeImageResultOnClient } from "./image-turn-receipts";
import { imageCallIdDto } from "../dream/imageTurnDto";
type Json = Record<string, unknown>;
function boundedStream(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader(); let total = 0;
  return new ReadableStream<Uint8Array>({ async pull(controller) {
    const next = await reader.read();
    if (next.done) { reader.releaseLock(); controller.close(); return; }
    total += next.value.byteLength;
    if (total > imageApiPolicy.maxResponseBytes) { await reader.cancel(); reader.releaseLock(); throw new GatewayError("UPSTREAM_RESPONSE_TOO_LARGE", "The Responses image stream exceeds the configured byte limit", 502, "upstream_error"); }
    controller.enqueue(next.value);
  }, async cancel(reason) { await reader.cancel(reason); reader.releaseLock(); } });
}
export function nativeResponsesBody(prepared: PreparedGatewayRequest, body: Json) {
  const turn = prepared.nativeImageTurn;
  if (!turn) throw new GatewayError("IMAGE_TURN_SELECTION_REQUIRED", "No native image operation was selected", 409, "invalid_request_error");
  const converted = record(adaptProviderRequest({ externalProtocol: "anthropic", providerProtocol: prepared.resolved.provider.protocol,
    providerAdapterKind: prepared.resolved.provider.adapterKind, providerConfig: prepared.resolved.provider.config,
    body: turn.executionBody, model: prepared.resolved.model.upstreamModel, maxOutputTokens: prepared.effectiveMaxOutputTokens }))!;
  const codex = prepared.resolved.provider.adapterKind === "codex";
  return { ...converted, stream: codex ? true : Boolean(body.stream),
    ...(codex ? { tools: [{ type: "image_generation" }], tool_choice: "auto" }
      : { tools: [{ type: "image_generation", action: turn.selection.operation === "native_edit" ? "edit" : "generate" }],
        tool_choice: { type: "image_generation" }, max_tool_calls: 1 }), parallel_tool_calls: false,
    input: Array.isArray(converted.input) ? converted.input : [] };
}
function textOutput(response: Json) {
  const text = (Array.isArray(response.output) ? response.output : []).flatMap(item => {
    const value = record(item);
    return value?.type === "message" && Array.isArray(value.content) ? value.content : [];
  }).flatMap(part => record(part)?.type === "output_text" && typeof record(part)?.text === "string" ? [String(record(part)!.text)] : []).join("\n");
  // An explicit completion message is necessary for the existing CLI to end a
  // server-tool-only response; this is delivery feedback, not invented model text.
  return text || "The image operation completed. The image result is attached.";
}
export async function proxyResponsesImage(input: { request: Request; prepared: PreparedGatewayRequest; body: Json }) {
  const { prepared } = input, turn = prepared.nativeImageTurn!;
  const startedAt = Date.now(), streaming = Boolean(input.body.stream);
  const headers = new Headers({ "cache-control": streaming ? "no-cache, no-transform" : "no-store", "x-request-id": prepared.requestId,
    "content-type": streaming ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8" });
  let transport: Awaited<ReturnType<typeof sendProviderRequest>> | undefined, dispatched = false, finalized = false;
  let closed = false;
  const localAbort = new AbortController(), signal = AbortSignal.any([input.request.signal, localAbort.signal]);
  const calls = new Map<string, number>(); let nextIndex = 0;
  const providerCalls = new Map<string, number>(), providerIndexes = new Map<number, string>();
  let safeSummary: Record<string, unknown> | undefined;
  let reported = parseResponsesReportedUsage(undefined);
  const accountingSummary = () => ({ billingScope: "responses_reported_tokens", requireFullTokenAllowanceCapture: true,
    imageBillingDetailsKnown: false, usageKnown: reported.usage !== null, reportedUsageStatus: reported.status, responsesUsage: reported.responsesUsage });
  const messageStart = { type: "message_start", message: { id: prepared.requestId, type: "message", role: "assistant", model: String(input.body.model),
    content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } } };
  async function execute(emit?: (event: Json) => void) {
    const providerBody = nativeResponsesBody(prepared, input.body);
    if (streaming) await markGatewayRequestStreaming(prepared.requestId);
    if (signal.aborted) throw signal.reason;
    transport = await sendProviderRequest({ resolved: prepared.resolved, body: providerBody, requestSignal: signal,
      requestHeaders: input.request.headers, gatewayRequestId: prepared.requestId, allowManagedCredentialRetry: false,
      onDispatch: () => { dispatched = true; } });
    let response: Json | undefined;
    const contentType = transport.response.headers.get("content-type")?.trim().toLowerCase() ?? "";
    if (contentType.includes("text/event-stream")
      || (!contentType && prepared.resolved.provider.adapterKind === "codex" && transport.response.body)) {
      if (!transport.response.body) throw new GatewayError("UPSTREAM_STREAM_INVALID", "The Responses image stream is empty", 502, "upstream_error");
      const state = new ResponsesStreamResponseState();
      for await (const event of parseSseStream(boundedStream(transport.response.body), transport.abort.signal, transport.abort.refreshStreamIdleTimeout)) {
        if (event.data === "[DONE]") break;
        let value: Json;
        try { const parsed = JSON.parse(event.data); if (!record(parsed)) throw new Error(); value = parsed; }
        catch { throw new GatewayError("UPSTREAM_RESPONSES_IMAGE_INVALID", "The Responses image event is invalid", 502, "upstream_error"); }
        const item = record(value.item);
        if ((value.type === "response.output_item.added" || value.type === "response.output_item.done") && item?.type === "image_generation_call") {
          const id = String(item.id), providerIndex = value.output_index;
          if (!imageCallIdDto.safeParse(item.id).success || typeof providerIndex !== "number" || !Number.isSafeInteger(providerIndex) || providerIndex < 0
            || (providerCalls.has(id) && providerCalls.get(id) !== providerIndex)
            || (providerIndexes.has(providerIndex) && providerIndexes.get(providerIndex) !== id)
            || (!providerCalls.has(id) && providerCalls.size >= 1)) throw new GatewayError("UPSTREAM_RESPONSES_IMAGE_INVALID", "The Responses image call identity is invalid", 502, "upstream_error");
          providerCalls.set(id, providerIndex); providerIndexes.set(providerIndex, id);
        }
        if (value.type === "response.output_item.added" && item?.type === "image_generation_call") {
          if (calls.has(String(item.id))) throw new GatewayError("UPSTREAM_RESPONSES_IMAGE_INVALID", "The Responses image call identity is invalid", 502, "upstream_error");
          const id = String(item.id), index = nextIndex++; calls.set(id, index);
          emit?.({ type: "content_block_start", index, content_block: { type: "server_tool_use", id, name: "image_generation",
            input: {}, gateway_request_id: prepared.requestId } });
          emit?.({ type: "content_block_stop", index });
        }
        // The shared adapter throws on failed/cancelled terminals; retain any
        // official counts before it reports that original upstream failure.
        if ((value.type === "response.failed" || value.type === "response.cancelled") && !reported.usage) {
          reported = parseResponsesReportedUsage(value.response);
          safeSummary = { gatewayRequestId: prepared.requestId, imageCalls: [...providerCalls.keys()], ...accountingSummary() };
        }
        const terminal = state.push(value);
        if (terminal) {
          if (response) throw new GatewayError("UPSTREAM_RESPONSES_IMAGE_INVALID", "The Responses image terminal is duplicated", 502, "upstream_error");
          response = terminal;
          reported = parseResponsesReportedUsage(terminal);
          safeSummary = { gatewayRequestId: prepared.requestId, imageCalls: [...providerCalls.keys()], ...accountingSummary() };
        }
      }
    } else {
      const raw = await readLimitedBody({ body: transport.response.body, declaredLength: transport.response.headers.get("content-length"), maxBytes: imageApiPolicy.maxResponseBytes });
      try { const parsed = JSON.parse(new TextDecoder().decode(raw)); if (!record(parsed)) throw new Error(); response = parsed; }
      catch { throw new GatewayError("UPSTREAM_RESPONSES_IMAGE_INVALID", "The Responses image response is invalid", 502, "upstream_error"); }
    }
    if (!response) throw new GatewayError("UPSTREAM_RESPONSES_IMAGE_INVALID", "No completed Responses image result was received", 502, "upstream_error");
    reported = parseResponsesReportedUsage(response);
    safeSummary = { gatewayRequestId: prepared.requestId, imageCalls: [...providerCalls.keys()], ...accountingSummary() };
    if (signal.aborted) throw signal.reason;
    const parsed = await parseResponsesImageResult(response, { gatewayRequestId: prepared.requestId,
      providerHttpRequestId: transport.response.headers.get("x-request-id") ?? transport.response.headers.get("request-id"),
      operation: turn.selection.operation === "native_edit" ? "edit" : "generate", maxOutputImages: 1, configuredImageModel: null });
    if (signal.aborted) throw signal.reason;
    if ([...providerCalls].some(([id, index]) => parsed.images[0].callId !== id || parsed.images[0].outputIndex !== index)) throw new GatewayError("UPSTREAM_RESPONSES_IMAGE_INVALID", "The result has a different image call identity", 502, "upstream_error");
    // The frozen image receipt describes complete image billing details, while
    // Gateway accounting describes the independently validated request-wide counts.
    const imageSummary: Record<string, unknown> = { ...parsed.summary };
    delete imageSummary.usageKnown; delete imageSummary.usageUnknownReason;
    safeSummary = { ...imageSummary, ...accountingSummary() };
    await withPlatformTransaction(client => recordNativeImageResultOnClient(client, turn.context, parsed.summary));
    if (signal.aborted) throw signal.reason;
    finalized = true;
    if (reported.usage) {
      await finalizeKnownUsage({ requestId: prepared.requestId, usage: reported.usage, outcome: "succeeded", httpStatus: 200, startedAt,
        responseSummary: safeSummary, requireFullTokenAllowanceCapture: true });
    } else {
      const recorded = await finalizeUnknownUsage({ requestId: prepared.requestId, outcome: "succeeded", httpStatus: 200, startedAt,
        errorCode: "RESPONSES_IMAGE_USAGE_UNKNOWN", errorMessage: reported.status === "invalid"
          ? "Image delivery succeeded; reported Responses usage is invalid" : "Image delivery succeeded; Responses usage was not reported",
        responseSummary: safeSummary, requireTransition: true });
      if (!recorded) throw new GatewayError("IMAGE_RESULT_PERSIST_UNAVAILABLE", "The image request could not be persisted; it was not repeated", 503, "internal_error");
    }
    if (signal.aborted) throw signal.reason;
    const content: Json[] = [];
    for (const image of parsed.images) {
      const start = { type: "server_tool_use", id: image.callId, name: "image_generation", input: {}, gateway_request_id: prepared.requestId };
      if (!calls.has(image.callId)) { emit?.({ type: "content_block_start", index: nextIndex, content_block: start }); emit?.({ type: "content_block_stop", index: nextIndex++ }); }
      const result = { type: "image_generation_tool_result", tool_use_id: image.callId, gateway_request_id: prepared.requestId,
        response_id: parsed.responseId, content: [{ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.b64Json } }] };
      content.push(start, result); emit?.({ type: "content_block_start", index: nextIndex, content_block: result }); emit?.({ type: "content_block_stop", index: nextIndex++ });
    }
    const text = textOutput(response); content.push({ type: "text", text });
    emit?.({ type: "content_block_start", index: nextIndex, content_block: { type: "text", text: "" } });
    emit?.({ type: "content_block_delta", index: nextIndex, delta: { type: "text_delta", text } }); emit?.({ type: "content_block_stop", index: nextIndex++ });
    const safeUsage = { input_tokens: reported.usage?.inputTokens ?? 0, output_tokens: reported.usage?.outputTokens ?? 0 };
    emit?.({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: safeUsage }); emit?.({ type: "message_stop" });
    return { id: parsed.responseId, type: "message", role: "assistant", model: String(input.body.model), content, stop_reason: "end_turn", stop_sequence: null, usage: safeUsage };
  }
  async function failure(error: unknown) {
    if (!finalized) {
      finalized = true;
      if (dispatched && reported.usage) {
        const mapped = toGatewayError(error);
        try { await finalizeKnownUsage({ requestId: prepared.requestId, usage: reported.usage, outcome: signal.aborted ? "cancelled" : "failed",
          httpStatus: mapped.status, errorCode: signal.aborted ? "CLIENT_CANCELLED" : mapped.code, errorMessage: mapped.message,
          startedAt, responseSummary: safeSummary, requireFullTokenAllowanceCapture: true }); }
        catch (settlementError) { return toGatewayError(settlementError); }
      } else if (dispatched) await finalizeProviderFailure({ requestId: prepared.requestId, protocol: "openai", error, startedAt, cancelled: signal.aborted,
        responseSummary: safeSummary ?? { gatewayRequestId: prepared.requestId, imageCalls: [...providerCalls.keys()], ...accountingSummary() } });
      else await finalizeKnownUsage({ requestId: prepared.requestId, usage: emptyTokenUsage("total_including_cache"), outcome: signal.aborted ? "cancelled" : "failed", startedAt,
        responseSummary: { gatewayRequestId: prepared.requestId, rejectionStage: "before_provider_dispatch" } });
    }
    return toGatewayError(error);
  }
  if (!streaming) {
    try { return Response.json(await execute(), { status: 200, headers }); }
    catch (error) { const mapped = await failure(error); return Response.json({ type: "error", error: { type: mapped.type, code: mapped.code, message: mapped.message }, request_id: prepared.requestId }, { status: mapped.status, headers }); }
    finally { transport?.abort.cleanup(); }
  }
  return new Response(new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Json) => { if (!closed) controller.enqueue(new TextEncoder().encode(serializeSse({ protocol: "anthropic", data: event }).rawEvent)); };
      emit(messageStart);
      try { await execute(emit); }
      catch (error) { const mapped = await failure(error); emit({ type: "error", error: { type: mapped.type, code: mapped.code, message: mapped.message }, request_id: prepared.requestId }); }
      finally { transport?.abort.cleanup(); if (!closed) { closed = true; controller.close(); } }
    },
    async cancel() { closed = true; localAbort.abort(new DOMException("Client cancelled", "AbortError")); transport?.abort.abort(); await failure(signal.reason); transport?.abort.cleanup(); },
  }), { status: 200, headers });
}
