// [Sync] 2026-10-12: cover cancellation after result parsing and during known settlement, including valid zero usage.
// [Input] Mocked Image resolution, reservation, transport fences, and Provider usage outcomes.
// [Output] Deterministic failure settlement and pre-dispatch cancellation contracts.
// [Pos] Provider-free orchestration regression for the public Images handler.
// [Sync] 2026-10-09: require full Image capture and safe zero-usage release before dispatch.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayError } from "./errors";
import { ImageProviderHttpError } from "./image-transport";
import { handleImageGeneration } from "./image-handler";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  capability: vi.fn(),
  resolve: vi.fn(),
  begin: vi.fn(),
  send: vi.fn(),
  known: vi.fn(),
  failure: vi.fn(),
}));

vi.mock("./auth", () => ({ authenticateGatewayRequest: mocks.authenticate }));
vi.mock("../db/image-api-capability", () => ({ imageApiCapabilityAvailable: mocks.capability }));
vi.mock("../platform-db", () => ({ withPlatformClient: (run: (client: unknown) => unknown) => run({}) }));
vi.mock("../models/resolver", () => ({ resolveBillableModel: mocks.resolve }));
vi.mock("./repository", () => ({ beginGatewayRequest: mocks.begin }));
vi.mock("./image-transport", async (original) => ({
  ...(await original<typeof import("./image-transport")>()),
  sendImageProviderRequest: mocks.send,
}));
vi.mock("./lifecycle", () => ({
  finalizeKnownUsage: mocks.known,
  finalizeProviderFailure: mocks.failure,
}));

const resolved = {
  model: {
    id: "model-image",
    code: "image-alias",
    upstreamModel: "image-upstream",
    displayName: "Image",
    imageOutputTokenReservePerImage: 100,
    capabilities: { image_generation: true },
    requestHeaders: {},
  },
  provider: {
    id: "provider-image",
    code: "provider-image",
    protocol: "openai" as const,
    baseUrl: "https://example.invalid",
    adapterKind: "generic" as const,
    timeoutMs: 1_000,
    maxRetries: 0,
    config: { imageApi: { kind: "openai" } },
  },
  pricingRuleId: "price-image",
  pricing: {
    inputPriceMicrousdPerMillion: 1,
    outputPriceMicrousdPerMillion: 0,
    cacheReadPriceMicrousdPerMillion: 0,
    cacheWritePriceMicrousdPerMillion: 0,
    imageOutputPriceMicrousdPerMillion: 1,
    markupBps: 0,
    discountBps: 0,
  },
  limits: {},
};

function generation(signal?: AbortSignal) {
  return new Request("https://gateway.test/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "image-alias", prompt: "draw" }),
    signal,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({ platformUserId: "user", dailyTokenLimit: undefined, monthlyTokenLimit: undefined });
  mocks.capability.mockResolvedValue(true);
  mocks.resolve.mockResolvedValue(resolved);
  mocks.begin.mockResolvedValue({ kind: "reserved", requestId: "req-image" });
  mocks.known.mockResolvedValue(undefined);
  mocks.failure.mockResolvedValue(new GatewayError("UPSTREAM_ERROR", "failed", 502, "upstream_error"));
});

describe("Image handler settlement fences", () => {
  it("requires full allowance capture for a 200 response with reliable usage but no image", async () => {
    mocks.send.mockImplementation(async (input: { onDispatch?: () => void }) => {
      input.onDispatch?.();
      return {
        response: Response.json({
          created: 1,
          data: [],
          usage: {
            total_tokens: 13,
            input_tokens: 3,
            output_tokens: 10,
            input_tokens_details: { text_tokens: 3, image_tokens: 0 },
            output_tokens_details: { text_tokens: 0, image_tokens: 10 },
          },
        }),
        cleanup: vi.fn(),
        managedRenewed: false,
      };
    });
    const response = await handleImageGeneration(generation());
    expect(response.status).toBe(502);
    expect(mocks.failure).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "req-image",
      requireFullTokenAllowanceCapture: true,
      usage: expect.objectContaining({ inputTextTokens: 3, outputImageTokens: 10 }),
    }));
  });

  it("releases a reserved request with known zero usage when cancellation happens before dispatch", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    mocks.send.mockRejectedValue(controller.signal.reason);
    const response = await handleImageGeneration(generation(controller.signal));
    expect(response.status).toBe(499);
    expect(mocks.known).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "req-image",
      outcome: "cancelled",
      requireFullTokenAllowanceCapture: true,
      usage: expect.objectContaining({ inputTokens: 0, outputTokens: 0 }),
      responseSummary: expect.objectContaining({ providerDispatched: false, usageKnown: true }),
    }));
    expect(mocks.failure).not.toHaveBeenCalled();
  });

  it("settles trusted usage from a non-2xx Image response through the full-capture path", async () => {
    const usage = {
      inputTokens: 3,
      outputTokens: 10,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputTokenSemantics: "fresh" as const,
      inputTextTokens: 3,
      inputImageTokens: 0,
      outputTextTokens: 0,
      outputImageTokens: 10,
    };
    mocks.send.mockImplementation(async (input: { onDispatch?: () => void }) => {
      input.onDispatch?.();
      throw new ImageProviderHttpError(503, { error: "busy" }, "upstream-request", usage);
    });
    await handleImageGeneration(generation());
    expect(mocks.failure).toHaveBeenCalledWith(expect.objectContaining({
      usage,
      requireFullTokenAllowanceCapture: true,
    }));
    expect(mocks.known).not.toHaveBeenCalled();
  });
});


it.each([0, 13])("preserves valid reported usage when cancelled after body read (%i tokens)", async (total) => {
  const controller = new AbortController();
  mocks.send.mockImplementation(async (input: { onDispatch?: () => void }) => {
    input.onDispatch?.();
    return {
      response: Response.json({ created: 1, data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }],
        usage: { total_tokens: total, input_tokens: 0, output_tokens: total,
          input_tokens_details: { text_tokens: 0, image_tokens: 0 },
          output_tokens_details: { text_tokens: 0, image_tokens: total } } }),
      cleanup: () => controller.abort(), managedRenewed: false,
    };
  });
  const response = await handleImageGeneration(generation(controller.signal));
  expect(response.status).toBe(499);
  expect(mocks.known).toHaveBeenCalledTimes(1);
  expect(mocks.known).toHaveBeenCalledWith(expect.objectContaining({ outcome: "cancelled",
    httpStatus: 499, usage: expect.objectContaining({ outputTokens: total }) }));
  expect(mocks.failure).not.toHaveBeenCalled();
});

it("does not publish a success body if the client cancels while known settlement commits", async () => {
  const controller = new AbortController();
  mocks.send.mockImplementation(async (input: { onDispatch?: () => void }) => {
    input.onDispatch?.();
    return { response: Response.json({ created: 1,
      data: [{ b64_json: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }],
      usage: { total_tokens: 13, input_tokens: 0, output_tokens: 13,
        input_tokens_details: { text_tokens: 0, image_tokens: 0 },
        output_tokens_details: { text_tokens: 0, image_tokens: 13 } } }),
      cleanup: vi.fn(), managedRenewed: false };
  });
  mocks.known.mockImplementation(async () => { controller.abort(); });
  const response = await handleImageGeneration(generation(controller.signal));
  expect(response.status).toBe(499);
  expect(mocks.known).toHaveBeenCalledTimes(1);
  expect(mocks.known).toHaveBeenCalledWith(expect.objectContaining({ outcome: "succeeded" }));
  expect(mocks.failure).not.toHaveBeenCalled();
  expect(await response.json()).not.toHaveProperty("data");
});


it("keeps strict zero usage known when an aborted response also contains invalid image bytes", async () => {
  const controller = new AbortController();
  mocks.send.mockImplementation(async (input: { onDispatch?: () => void }) => {
    input.onDispatch?.();
    return { response: Response.json({ created: 1, data: [{ b64_json: "aGVsbG8=" }],
      usage: { total_tokens: 0, input_tokens: 0, output_tokens: 0,
        input_tokens_details: { text_tokens: 0, image_tokens: 0 },
        output_tokens_details: { text_tokens: 0, image_tokens: 0 } } }),
      cleanup: () => controller.abort(), managedRenewed: false };
  });
  const response = await handleImageGeneration(generation(controller.signal));
  expect(response.status).toBe(499);
  expect(mocks.known).toHaveBeenCalledTimes(1);
  expect(mocks.known).toHaveBeenCalledWith(expect.objectContaining({ outcome: "cancelled",
    usage: expect.objectContaining({ inputTokens: 0, outputTokens: 0 }) }));
  expect(mocks.failure).not.toHaveBeenCalled();
});
