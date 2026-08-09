import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareGatewayRequest, preparationErrorResponse } from "./prepare";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  resolve: vi.fn(),
  begin: vi.fn(),
  recordRequest: vi.fn(),
  recordResponse: vi.fn(),
  markCaptureFailure: vi.fn(),
}));

vi.mock("./auth", () => ({ authenticateGatewayRequest: mocks.authenticate }));
vi.mock("../models/resolver", () => ({ resolveBillableModel: mocks.resolve }));
vi.mock("./repository", () => ({ beginGatewayRequest: mocks.begin }));
vi.mock("./payloads", () => ({
  recordGatewayRequestPayload: mocks.recordRequest,
  recordGatewayJsonResponse: mocks.recordResponse,
  markGatewayPayloadCaptureFailure: mocks.markCaptureFailure,
  safePayloadWrite: (operation: Promise<unknown>) => operation.catch(() => undefined),
}));

const resolved = {
  model: {
    id: "model_test",
    code: "deepseek-v4-flash",
    upstreamModel: "deepseek-v4-flash",
    displayName: "DeepSeek Flash",
    contextWindow: 128_000,
    maxOutputTokens: 32_768,
    capabilities: {},
  },
  provider: {
    id: "provider_test",
    code: "deepseek-anthropic",
    protocol: "anthropic" as const,
    baseUrl: "https://provider.invalid",
    encryptedCredential: { ciphertext: "cipher", iv: "iv", tag: "tag" },
    timeoutMs: 30_000,
    maxRetries: 0,
    config: {},
  },
  pricingRuleId: "price_test",
  pricing: {
    inputPriceMicrousdPerMillion: 1_000,
    outputPriceMicrousdPerMillion: 2_000,
    cacheReadPriceMicrousdPerMillion: 100,
    cacheWritePriceMicrousdPerMillion: 200,
    markupBps: 0,
    discountBps: 0,
  },
  limits: { dailyTokenLimit: 100_000 },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authenticate.mockResolvedValue({
    apiKeyId: "key_test",
    platformUserId: "user_test",
    source: "ink-dream",
    externalUserId: "dream_test",
    tier: "free",
    scopes: ["messages:create"],
    dailyTokenLimit: 100_000,
  });
  mocks.resolve.mockResolvedValue(resolved);
  mocks.recordRequest.mockResolvedValue(undefined);
  mocks.recordResponse.mockResolvedValue(undefined);
  mocks.markCaptureFailure.mockResolvedValue(undefined);
});

describe("gateway preparation payload capture", () => {
  it("returns Token allowance exhaustion fields without micro-USD fields", async () => {
    const result = {
      kind: "rejected" as const,
      requestId: "req_subscription_tokens",
      code: "SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED",
      status: 402 as const,
      message: "The current subscription-period Token allowance is insufficient",
      metric: "tokens" as const,
      unit: "tokens" as const,
      availableTokens: 512,
      requiredTokens: 1_024,
      periodEnd: "2026-09-01T00:00:00.000Z",
    };

    const response = await preparationErrorResponse(result, "anthropic");
    expect(response.status).toBe(402);
    const body = await response.json();
    expect(body).toMatchObject({
      type: "error",
      request_id: "req_subscription_tokens",
      error: {
        type: "billing_error",
        code: "SUBSCRIPTION_TOKEN_ALLOWANCE_EXHAUSTED",
        request_id: "req_subscription_tokens",
        metric: "tokens",
        unit: "tokens",
        available_tokens: 512,
        required_tokens: 1_024,
        period_end: "2026-09-01T00:00:00.000Z",
      },
    });
    expect(body.error).not.toHaveProperty("available_microusd");
    expect(body.error).not.toHaveProperty("required_microusd");
    expect(mocks.recordResponse).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "req_subscription_tokens",
      status: 402,
    }));
  });

  it("captures both sides of a rejected Anthropic request with protocol-correct JSON", async () => {
    mocks.begin.mockResolvedValue({
      kind: "rejected",
      requestId: "req_limit",
      code: "DAILY_TOKEN_LIMIT_EXCEEDED",
      message: "Daily token limit exceeded: current=64045, requested=45242, limit=100000, remaining=35955, exceeded_by=9287",
      limit: 100_000,
      current: 64_045,
      requested: 45_242,
      remaining: 35_955,
      exceededBy: 9_287,
      limitWindow: "day",
      limitMetric: "tokens",
    });
    const rawBody = JSON.stringify({
      model: "deepseek-v4-flash",
      max_tokens: 32_768,
      messages: [{ role: "user", content: "hello" }],
    });
    const request = new Request("http://localhost/v1/messages?beta=true", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": "gw_secret-never-persist",
      },
      body: rawBody,
    });
    const result = await prepareGatewayRequest({
      headers: request.headers,
      requiredScope: "messages:create",
      protocol: "anthropic",
      requestedModel: "deepseek-v4-flash",
      isStreaming: true,
      estimatedInputTokens: 12_474,
      requestedMaxOutputTokens: 32_768,
      requestCapture: { request, rawBody, body: JSON.parse(rawBody) },
    });

    expect(result).toMatchObject({ kind: "rejected", requestId: "req_limit" });
    expect(mocks.recordRequest).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "req_limit",
      requestedModel: "deepseek-v4-flash",
      providerProtocol: "anthropic",
      capture: expect.objectContaining({ rawBody }),
    }));

    if (result.kind !== "rejected") throw new Error("expected rejected result");
    const response = await preparationErrorResponse(result, "anthropic");
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toMatchObject({
      type: "error",
      request_id: "req_limit",
      error: {
        type: "rate_limit_error",
        code: "DAILY_TOKEN_LIMIT_EXCEEDED",
        request_id: "req_limit",
        limit: 100_000,
        current: 64_045,
        requested: 45_242,
        remaining: 35_955,
        exceeded_by: 9_287,
        limit_window: "day",
        limit_metric: "tokens",
      },
    });
    expect(mocks.recordResponse).toHaveBeenCalledWith(expect.objectContaining({
      requestId: "req_limit",
      status: 429,
      body: expect.objectContaining({ type: "error" }),
    }));
  });

  it("does not overwrite the original payload when an idempotency key is replayed", async () => {
    const response = await preparationErrorResponse({
      kind: "replay",
      request: {
        id: "req_original",
        status: "settled",
        outcome: "succeeded",
        is_streaming: false,
        http_status: 200,
        response_summary: { id: "provider_message" },
        error_code: null,
        error_message: null,
      },
    }, "openai");

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "REQUEST_ALREADY_COMPLETED", request_id: "req_original" },
    });
    expect(mocks.recordRequest).not.toHaveBeenCalled();
    expect(mocks.recordResponse).not.toHaveBeenCalled();
  });
});
