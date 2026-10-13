// [Input] Frozen native turn, actual Responses image JSON/SSE and controlled persistence/abort boundaries.
// [Output] Single-route execution, real identity, unknown billing and cancellation race evidence.
// [Pos] Isolated native proxy contract tests; fake upstream bytes are not real model acceptance.
// [Sync] 2026-10-10: verify the public Messages image branch without Images fallback or automatic replay.
// [Sync] 2026-10-11: cover observed Codex wire shape and hidden/mismatched stream calls.
import { beforeEach, expect, it, vi } from "vitest";
import type { PreparedGatewayRequest } from "./prepare";
const mock = vi.hoisted(() => ({ send: vi.fn(), result: vi.fn(), unknown: vi.fn(), failure: vi.fn(), known: vi.fn() }));
vi.mock("./provider-transport", () => ({ sendProviderRequest: mock.send }));
vi.mock("../platform-db", () => ({ withPlatformTransaction: async (action: (client: unknown) => Promise<unknown>) => action({ marker: "original" }) }));
vi.mock("./image-turn-receipts", () => ({ recordNativeImageResultOnClient: mock.result }));
vi.mock("./repository", () => ({ markGatewayRequestStreaming: vi.fn() }));
vi.mock("./lifecycle", () => ({ finalizeKnownUsage: mock.known, finalizeUnknownUsage: mock.unknown, finalizeProviderFailure: mock.failure }));
import { GatewayError } from "./errors";
import { nativeResponsesBody, proxyResponsesImage } from "./responses-image-proxy";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const response = { id: "resp_actual", status: "completed", output: [{ type: "image_generation_call", id: "ig_actual", status: "completed", action: "generate", result: png }] };
function prepared() { return { requestId: "req_" + "a".repeat(32), effectiveMaxOutputTokens: 128,
  resolved: { provider: { protocol: "openai", adapterKind: "generic", config: { openaiApi: "responses" } }, model: { upstreamModel: "ai_upstream" } },
  nativeImageTurn: { context: {}, selection: { operation: "native_generate" }, prompt: "Image operation", inputImages: 0,
    executionBody: { model: "ai_alias", messages: [{ role: "user", content: [{ type: "text", text: "Image operation" }] }] } } } as unknown as PreparedGatewayRequest; }
function call(stream = false, signal?: AbortSignal) {
  return proxyResponsesImage({ request: new Request("http://localhost/v1/messages", { signal }), prepared: prepared(), body: { model: "ai_alias", stream } });
}
beforeEach(() => {
  vi.clearAllMocks(); mock.result.mockResolvedValue({}); mock.unknown.mockResolvedValue(true);
  mock.known.mockResolvedValue({}); mock.failure.mockResolvedValue({});
  mock.send.mockImplementation(async input => {
    input.onDispatch();
    return { response: Response.json(response, { headers: { "x-request-id": "http_actual" } }),
      abort: { signal: input.requestSignal, cleanup() {}, abort() {}, refreshStreamIdleTimeout() {} } };
  });
});
it("uses the frozen AI alias and only a forced native tool, leaving the Image model out", () => {
  const body = nativeResponsesBody(prepared(), { model: "ai_alias", stream: false, tools: [{ name: "imagegen" }] });
  expect(body).toMatchObject({ model: "ai_upstream", store: false, tools: [{ type: "image_generation", action: "generate" }], tool_choice: { type: "image_generation" }, max_tool_calls: 1, parallel_tool_calls: false });
  expect(JSON.stringify(body)).not.toContain("imagegen");
});
it("saves real result identity before acknowledging successful delivery with unknown complete usage", async () => {
  const reply = await call(); expect(reply.status).toBe(200);
  const data = await reply.json(); expect(data.id).toBe("resp_actual");
  expect(data.content[0]).toMatchObject({ type: "server_tool_use", id: "ig_actual" });
  expect(data.content[1]).toMatchObject({ type: "image_generation_tool_result", tool_use_id: "ig_actual", response_id: "resp_actual", gateway_request_id: prepared().requestId });
  expect(mock.send).toHaveBeenCalledOnce(); expect(mock.result).toHaveBeenCalledOnce();
  expect(mock.unknown).toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded", requireTransition: true,
    responseSummary: expect.objectContaining({ usageKnown: false, responseId: "resp_actual", providerHttpRequestId: "http_actual" }) }));
  expect(mock.result.mock.invocationCallOrder[0]).toBeLessThan(mock.unknown.mock.invocationCallOrder[0]);
  expect(mock.known).not.toHaveBeenCalled();
});
it("rejects result persistence or zero-row success acknowledgment without replay", async () => {
  mock.unknown.mockResolvedValue(false);
  const reply = await call(); expect(reply.status).toBe(503); expect(mock.send).toHaveBeenCalledOnce();
  expect(JSON.stringify(await reply.json())).not.toContain(png);
});
it("releases a predispatch reservation but preserves unknown usage after dispatch", async () => {
  mock.send.mockRejectedValue(new Error("configuration unavailable"));
  expect((await call()).status).toBeGreaterThanOrEqual(400);
  expect(mock.known).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", responseSummary: expect.objectContaining({ rejectionStage: "before_provider_dispatch" }) }));
  expect(mock.failure).not.toHaveBeenCalled();
  vi.clearAllMocks(); mock.send.mockImplementation(async input => { input.onDispatch(); throw new Error("connection lost"); });
  expect((await call()).status).toBeGreaterThanOrEqual(400);
  expect(mock.failure).toHaveBeenCalledOnce(); expect(mock.known).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
it("does not deliver a result after cancellation during its persistence", async () => {
  const abort = new AbortController(); mock.result.mockImplementation(async () => abort.abort(new DOMException("Cancelled", "AbortError")));
  const reply = await call(false, abort.signal); expect(reply.status).toBeGreaterThanOrEqual(400);
  expect(mock.unknown).not.toHaveBeenCalled(); expect(mock.failure).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true }));
  expect(JSON.stringify(await reply.json())).not.toContain(png);
});
it("projects complete streaming results through actual server call IDs", async () => {
  mock.send.mockImplementation(async input => { input.onDispatch(); return { response: new Response([
    { type: "response.output_item.added", output_index: 0, item: { type: "image_generation_call", id: "ig_actual", status: "in_progress" } },
    { type: "response.completed", response },
  ].map(value => `data: ${JSON.stringify(value)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } }),
    abort: { signal: input.requestSignal, cleanup() {}, abort() {}, refreshStreamIdleTimeout() {} } }; });
  const reply = await call(true), events = await reply.text();
  expect(events).toContain('"tool_use_id":"ig_actual"'); expect(events).toContain('"type":"message_stop"');
  expect(mock.send).toHaveBeenCalledOnce(); expect(mock.unknown).toHaveBeenCalledOnce();
});
it.each(["native_generate", "native_edit"])("keeps the observed Codex hosted shape for %s while preserving selected materials", operation => {
  const bound = prepared(); bound.resolved.provider.adapterKind = "codex"; bound.resolved.provider.config = {};
  bound.nativeImageTurn!.selection.operation = operation as "native_generate" | "native_edit";
  bound.nativeImageTurn!.executionBody.messages = [{ role: "user", content: [{ type: "text", text: "One image" }, { type: "image", source: { type: "base64", media_type: "image/png", data: png } }] }];
  const body = nativeResponsesBody(bound, { stream: false });
  expect(body).toMatchObject({ model: "ai_upstream", stream: true, store: false, include: ["reasoning.encrypted_content"], tools: [{ type: "image_generation" }], tool_choice: "auto", parallel_tool_calls: false });
  expect(body).not.toHaveProperty("max_tool_calls");
  expect(body.input).toEqual(expect.arrayContaining([expect.objectContaining({ content: expect.arrayContaining([expect.objectContaining({ type: "input_image", image_url: `data:image/png;base64,${png}` })]) })]));
});
async function streamed(events: unknown[], adapterKind: "generic" | "codex" = "codex", headerless = false) {
  mock.send.mockImplementation(async input => { input.onDispatch(); return {
    response: new Response(new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("")), { headers: headerless ? {} : { "content-type": "text/event-stream" } }),
    abort: { signal: input.requestSignal, cleanup() {}, abort() {}, refreshStreamIdleTimeout() {} },
  }; });
  const bound = prepared(); bound.resolved.provider.adapterKind = adapterKind;
  if (adapterKind === "codex") bound.resolved.provider.config = {};
  const reply = await proxyResponsesImage({ request: new Request("http://localhost/v1/messages"), prepared: bound, body: { model: "ai_alias", stream: false } });
  return reply;
}
it("accepts headerless Codex SSE for non-streaming CLI delivery, retaining one real call", async () => {
  const reply = await streamed([{ type: "response.output_item.done", output_index: 0, item: response.output[0] }, { type: "response.completed", response }], "codex", true);
  expect(reply.status).toBe(200); expect((await reply.json()).content[1].tool_use_id).toBe("ig_actual");
  expect(mock.send).toHaveBeenCalledOnce(); expect(mock.unknown).toHaveBeenCalledOnce();
});
it("keeps headerless non-Codex streams out of the compatibility rule", async () => {
  expect((await streamed([{ type: "response.completed", response }], "generic", true)).status).toBe(502);
  expect(mock.result).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
it.each([
  [{ type: "response.output_item.done", output_index: 0, item: response.output[0] }, { type: "response.output_item.done", output_index: 1, item: { ...response.output[0], id: "ig_hidden" } }],
  [{ type: "response.output_item.added", output_index: 0, item: response.output[0] }, { type: "response.output_item.done", output_index: 1, item: response.output[0] }],
  [{ type: "response.output_item.done", output_index: 1, item: response.output[0] }],
  [{ type: "response.completed", response }],
].map(events => ({ events })))("rejects hidden/mismatched calls or duplicate terminal without delivery or replay: $events", async ({ events }) => {
  const reply = await streamed([...events, { type: "response.completed", response }]);
  expect(reply.status).toBe(502); expect(mock.result).not.toHaveBeenCalled(); expect(mock.unknown).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
  if (events.some(event => event.type === "response.output_item.done")) {
    expect(mock.failure).toHaveBeenCalledWith(expect.objectContaining({ responseSummary: expect.objectContaining({ imageCalls: ["ig_actual"] }) }));
  }
});

// [Sync] 2026-10-11: reliable reported Token settlement, failure/cancel counts and single finalization.
const officialUsage = { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 40 }, output_tokens_details: { reasoning_tokens: 5 } };
function jsonUpstream(value: unknown) {
  mock.send.mockImplementation(async input => { input.onDispatch(); return { response: Response.json(value), abort: { signal: input.requestSignal, cleanup() {}, abort() {}, refreshStreamIdleTimeout() {} } }; });
}
it.each(["generate", "edit"])("settles official JSON %s usage once without altering frozen receipt", async action => {
  jsonUpstream({ ...response, usage: officialUsage, output: [{ ...response.output[0], action }] });
  const bound = prepared(); bound.nativeImageTurn!.selection.operation = action === "edit" ? "native_edit" : "native_generate";
  const reply = await proxyResponsesImage({ request: new Request("http://localhost/v1/messages"), prepared: bound, body: { model: "ai_alias" } });
  expect(reply.status).toBe(200); expect((await reply.json()).usage).toEqual({ input_tokens: 100, output_tokens: 20 });
  expect(mock.known).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, inputTokenSemantics: "total_including_cache" }), requireFullTokenAllowanceCapture: true, outcome: "succeeded", responseSummary: expect.objectContaining({ usageKnown: true, billingScope: "responses_reported_tokens", imageBillingDetailsKnown: false }) }));
  expect(mock.result.mock.calls[0][2]).toMatchObject({ usageKnown: false, usageUnknownReason: "responses_image_usage_not_reported" });
  expect(mock.unknown).not.toHaveBeenCalled(); expect(mock.failure).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
it("settles headerless Codex SSE reported counts and preserves same CLI usage", async () => {
  const reply = await streamed([{ type: "response.completed", response: { ...response, usage: officialUsage } }], "codex", true);
  expect(reply.status).toBe(200); expect((await reply.json()).usage).toEqual({ input_tokens: 100, output_tokens: 20 });
  expect(mock.known).toHaveBeenCalledOnce(); expect(mock.unknown).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
it("invalid usage stays unknown and is never coerced into CLI counts", async () => {
  jsonUpstream({ ...response, usage: { ...officialUsage, input_tokens: "100" } });
  const reply = await call(); expect(reply.status).toBe(200); expect((await reply.json()).usage).toEqual({ input_tokens: 0, output_tokens: 0 });
  expect(mock.unknown).toHaveBeenCalledWith(expect.objectContaining({ responseSummary: expect.objectContaining({ reportedUsageStatus: "invalid", responsesUsage: null }) }));
  expect(mock.known).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
it.each([officialUsage, { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } }])("retains reliable counts including zero on image decode failure", async usage => {
  jsonUpstream({ ...response, usage, output: [{ ...response.output[0], result: "invalid" }] });
  expect((await call()).status).toBe(502);
  expect(mock.known).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", usage: expect.objectContaining({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens }), requireFullTokenAllowanceCapture: true }));
  expect(mock.failure).not.toHaveBeenCalled(); expect(mock.unknown).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
it("preserves reliable counts on cancellation during result persistence", async () => {
  jsonUpstream({ ...response, usage: officialUsage });
  const abort = new AbortController(); mock.result.mockImplementation(async () => abort.abort(new DOMException("Cancelled", "AbortError")));
  const reply = await call(false, abort.signal); expect(reply.status).toBeGreaterThanOrEqual(400);
  expect(mock.known).toHaveBeenCalledWith(expect.objectContaining({ outcome: "cancelled", usage: expect.objectContaining({ inputTokens: 100 }), errorCode: "CLIENT_CANCELLED" }));
  expect(mock.failure).not.toHaveBeenCalled(); expect(mock.unknown).not.toHaveBeenCalled(); expect(JSON.stringify(await reply.json())).not.toContain(png);
});
it("does not overwrite known pending or replay the Provider when settlement fails", async () => {
  jsonUpstream({ ...response, usage: officialUsage });
  mock.known.mockRejectedValueOnce(new GatewayError("BILLING_SETTLEMENT_UNAVAILABLE", "Pending", 503, "internal_error"));
  const reply = await call(); expect(reply.status).toBe(503); expect((await reply.json()).error.code).toBe("BILLING_SETTLEMENT_UNAVAILABLE");
  expect(mock.known).toHaveBeenCalledOnce(); expect(mock.failure).not.toHaveBeenCalled(); expect(mock.unknown).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
it("retains a terminal report when a later SSE event is malformed", async () => {
  const reply = await streamed([{ type: "response.completed", response: { ...response, usage: officialUsage } }, { type: "response.output_item.done", output_index: -1, item: response.output[0] }]);
  expect(reply.status).toBe(502); expect(mock.known).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed", usage: expect.objectContaining({ inputTokens: 100 }) }));
  expect(mock.failure).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});

it.each(["failed", "cancelled"])("preserves official SSE %s terminal usage before the shared adapter throws", async status => {
  const usage = { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } };
  const reply = await streamed([{ type: `response.${status}`, response: { ...response, status, usage, error: { code: "upstream_failure", message: "Failure" } } }]);
  expect(reply.status).toBeGreaterThanOrEqual(400);
  expect(mock.known).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ outcome: "failed", usage: expect.objectContaining({ inputTokens: 0, outputTokens: 0 }), requireFullTokenAllowanceCapture: true }));
  expect(mock.failure).not.toHaveBeenCalled(); expect(mock.unknown).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
it.each([undefined, { ...officialUsage, total_tokens: 999 }])("keeps missing/invalid SSE failed reports unknown", async usage => {
  const reply = await streamed([{ type: "response.failed", response: { ...response, status: "failed", usage, error: { message: "Failure" } } }]);
  expect(reply.status).toBeGreaterThanOrEqual(400); expect(mock.failure).toHaveBeenCalledOnce(); expect(mock.known).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
it("does not discard a completed report when a later failed terminal omits usage", async () => {
  const reply = await streamed([{ type: "response.completed", response: { ...response, usage: officialUsage } }, { type: "response.failed", response: { ...response, status: "failed", error: { message: "Failure" } } }]);
  expect(reply.status).toBeGreaterThanOrEqual(400); expect(mock.known).toHaveBeenCalledWith(expect.objectContaining({ usage: expect.objectContaining({ inputTokens: 100 }) }));
  expect(mock.failure).not.toHaveBeenCalled(); expect(mock.send).toHaveBeenCalledOnce();
});
