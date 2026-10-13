// [Input] Isolated Responses bodies, fixed Provider credentials and the production model-validation helpers.
// [Output] Full-image/stream, single-dispatch, safe failure and strict DTO regression evidence.
// [Pos] Provider-free verification contracts; no account, normal database or real model is used.
// [Sync] 2026-10-11: distinguish hosted image validation from HTTP-only text validation.
import { describe, expect, it, vi } from "vitest";
import { readResponsesImageValidation } from "./responses-image-validation";
import { modelValidationInputSchema, validateManagedUpstreamModel, validateUpstreamModel } from "./model-validation";
import { readLimitedBody } from "../gateway/read-limited-body";
import * as imageProtocols from "../gateway/image-protocols";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const call = { type: "image_generation_call", id: "ig_real", status: "completed", result: png, action: "generate" };
const output = { id: "resp_real", status: "completed", output: [call] };
const headers = new Headers({ authorization: "Bearer fixture-secret" });
const read = (response: Response, adapterKind = "generic") => readResponsesImageValidation({ response, adapterKind, credentialHeaders: headers, signal: AbortSignal.timeout(5_000) });
const sse = (events: unknown[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n";
const managed = { providerId: "provider-fixture", adapterKind: "codex" as const, authEpoch: 1,
  managedAccountId: "account-fixture", managedAccountAuthEpoch: 1, credentialRevision: 1,
  upstreamModel: "fixture", validationKind: "responses_image_generation" as const, timeoutMs: 30_000 };
const access = async () => ({ adapterKind: "codex" as const, dialect: "openai_responses" as const,
  url: "https://chatgpt.com/backend-api/codex/responses", headers,
  credentialRevision: 1, accountId: "account-fixture", accountAuthEpoch: 1, defaultRevision: null, renewed: false });

describe("actual hosted image verification", () => {
  it("requires a strict optional kind, rejecting body overrides", () => {
    expect(modelValidationInputSchema.parse({})).toEqual({});
    expect(modelValidationInputSchema.parse({ validationKind: managed.validationKind })).toEqual({ validationKind: managed.validationKind });
    for (const input of [{ validationKind: "images" }, { validationKind: managed.validationKind, prompt: "override" }, { model: "other" }, { endpoint: "override" }]) {
      expect(modelValidationInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("decodes the full JSON image and returns only actual identities and safe bytes metadata", async () => {
    const result = await read(Response.json({ ...output, revised_prompt: "private-prompt" }, { headers: { "x-request-id": "http_real" } }));
    expect(result).toMatchObject({ usable: true, validationKind: managed.validationKind, upstreamRequestId: "http_real", imageSummary: { responseId: "resp_real", imageCalls: [{ callId: "ig_real", byteLength: 68 }] } });
    for (const privateValue of [png, "private-prompt", "fixture-secret", "gatewayRequestId", "req_"]) expect(JSON.stringify(result)).not.toContain(privateValue);
  });
  it.each(["text/event-stream", ""])('reads Codex SSE including missing content-type %s with output snapshots', async contentType => {
    const response = new Response(new TextEncoder().encode(sse([{ type: "response.output_item.added", output_index: 0, item: { ...call, status: "in_progress", result: null } },
      { type: "response.output_item.done", output_index: 0, item: call }, { type: "response.completed", response: { ...output, output: [] } }])),
      { headers: contentType ? { "content-type": contentType } : {} });
    expect((await read(response, "codex")).usable).toBe(true);
  });
  it.each([{}, { ...output, output: [] }, { ...output, status: "incomplete" }, { ...output, output: [{ ...call, result: "bad" }] },
    { ...output, output: [call, { ...call, id: "ig_second" }] }, { ...output, output: [{ ...call, action: "edit" }] }])("rejects 200 without a complete valid single generation", async value => {
    expect(await read(Response.json(value))).toMatchObject({ usable: false, failureCode: "RESPONSES_IMAGE_RESULT_INVALID" });
  });
  it.each([
    [{ type: "response.output_item.done", output_index: 0, item: call }],
    [{ type: "response.output_item.done", output_index: 0, item: { ...call, id: "ig_hidden" } }, { type: "response.completed", response: output }],
    [{ type: "response.completed", response: output }, { type: "response.completed", response: output }],
    [{ type: "response.output_item.added", output_index: 0, item: call }, { type: "response.output_item.added", output_index: 1, item: call }, { type: "response.completed", response: output }],
    [{ type: "response.output_item.added", output_index: 0, item: call }, { type: "response.output_item.done", output_index: 0, item: { ...call, id: "ig_other" } }, { type: "response.completed", response: output }],
  ].map(events => ({ events })))("rejects missing terminal, hidden extra call or duplicate terminal", async ({ events }) => {
    expect((await read(new Response(sse(events), { headers: { "content-type": "text/event-stream" } }), "codex")).usable).toBe(false);
  });
  it("never returns echoed prompt, image, credentials or arbitrary Provider error fields", async () => {
    const result = await read(Response.json({ error: { message: `private-prompt ${png} fixture-secret`, code: "unsupported_tool", type: "invalid_request_error", detail: "private-body" } },
      { status: 400, headers: { "x-request-id": "fixture-secret" } }));
    expect(result).toMatchObject({ usable: false, failureCode: "RESPONSES_IMAGE_UPSTREAM_REJECTED", upstreamErrorCode: "unsupported_tool", upstreamErrorType: "invalid_request_error" });
    for (const privateValue of ["private-prompt", png, "fixture-secret", "private-body", "upstreamMessage"]) expect(JSON.stringify(result)).not.toContain(privateValue);
    const arbitrary = await read(Response.json({ error: { code: "private-prompt", type: "private-body" } }, { status: 400 }));
    expect(arbitrary).not.toHaveProperty("upstreamErrorCode");expect(arbitrary).not.toHaveProperty("upstreamErrorType");
  });
  it.each([
    { ...output, id: "fixture-secret" },
    { ...output, output: [{ ...call, id: "fixture-secret" }] },
  ])("rejects Provider credential reflected as an otherwise valid result identity", async value => {
    const result = await read(Response.json(value));
    expect(result).toMatchObject({ usable: false, failureCode: "RESPONSES_IMAGE_RESULT_INVALID" });
    expect(JSON.stringify(result)).not.toContain("fixture-secret");expect(result).not.toHaveProperty("imageSummary");
  });
  it("cannot pass if the deadline expires during full image decoding", async () => {
    const abort = new AbortController();
    const decode = imageProtocols.validateBase64Image;
    const spy = vi.spyOn(imageProtocols, "validateBase64Image").mockImplementationOnce(async value => {
      abort.abort(new DOMException("deadline", "TimeoutError"));return decode(value);
    });
    try {
      const result = await readResponsesImageValidation({ response: Response.json(output), adapterKind: "generic", credentialHeaders: headers, signal: abort.signal });
      expect(result).toMatchObject({ usable: false, failureCode: "RESPONSES_IMAGE_TIMEOUT" });expect(result).not.toHaveProperty("imageSummary");
    } finally { spy.mockRestore(); }
  });
  it("cancels oversized output before consuming it", async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ cancel }), { headers: { "content-length": String(65 * 1024 * 1024) } });
    expect(await read(response)).toMatchObject({ usable: false, failureCode: "RESPONSES_IMAGE_LIMIT_EXCEEDED" });expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("cancels a stalled read on the existing Provider deadline", async () => {
    const cancel = vi.fn();const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const pending = readLimitedBody({ body, maxBytes: 20, signal: abort.signal });
    abort.abort(new DOMException("deadline", "TimeoutError"));
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });expect(cancel).toHaveBeenCalledTimes(1);expect(body.locked).toBe(false);
  });
  it("uses one Provider-owned Codex request with supported original fields and no Images fallback", async () => {
    const fetcher = vi.fn(async () => new Response(sse([{ type: "response.completed", response: output }]), { headers: { "content-type": "text/event-stream" } }));
    const result = await validateManagedUpstreamModel(managed, { resolveAccess: access, fetcher });
    expect(result.usable).toBe(true);expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://chatgpt.com/backend-api/codex/responses");
    const request = JSON.parse(String(init.body));
    expect(request).toMatchObject({ model: "fixture", tools: [{ type: "image_generation" }], tool_choice: "auto", stream: true, store: false, include: ["reasoning.encrypted_content"] });
    expect(request).not.toHaveProperty("max_tool_calls");expect(request.tools[0]).not.toHaveProperty("action");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fixture-secret");
  });
  it("does not retry a Codex rejection or accept xAI / default OpenAI Chat", async () => {
    const fetcher = vi.fn(async () => Response.json({ error: { message: "private-prompt" } }, { status: 401 }));
    expect((await validateManagedUpstreamModel(managed, { resolveAccess: access, fetcher })).usable).toBe(false);expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(validateManagedUpstreamModel({ ...managed, adapterKind: "xai" }, { fetcher })).rejects.toMatchObject({ code: "RESPONSES_IMAGE_VALIDATION_UNSUPPORTED" });
    await expect(validateUpstreamModel({ protocol: "openai", baseUrl: "https://api.openai.com", upstreamModel: "fixture", credential: "fixture", validationKind: managed.validationKind, maxOutputTokens: 100 }, { fetcher })).rejects.toMatchObject({ code: "RESPONSES_IMAGE_VALIDATION_UNSUPPORTED" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
