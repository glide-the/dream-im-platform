import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePrincipal: vi.fn(),
  getPlans: vi.fn(),
  getContext: vi.fn(),
  getUsage: vi.fn(),
  getModels: vi.fn(),
  previewCommand: vi.fn(),
  executeCommand: vi.fn(),
  createPaymentIntent: vi.fn(),
  getPaymentIntent: vi.fn(),
}));

vi.mock("@/lib/product/auth", () => ({
  requireProductPrincipal: mocks.requirePrincipal,
}));

vi.mock("@/lib/product/service", () => ({
  getProductPlans: mocks.getPlans,
  getProductSubscriptionContext: mocks.getContext,
  getProductUsage: mocks.getUsage,
  getProductModelCatalog: mocks.getModels,
  previewProductSubscriptionCommand: mocks.previewCommand,
  executeProductSubscriptionCommand: mocks.executeCommand,
}));

vi.mock("@/lib/payments/service", () => ({
  createProductPaymentIntent: mocks.createPaymentIntent,
  getProductPaymentIntent: mocks.getPaymentIntent,
}));

import { ProductError } from "@/lib/product/errors";
import { GET as getPlans } from "./plans/route";
import { GET as getContext } from "./me/subscription-context/route";
import { GET as getUsage } from "./me/usage/route";
import { GET as getModels } from "./me/model-catalog/route";
import { POST as postCommand } from "./me/subscription-commands/route";
import { POST as postPaymentIntent } from "./me/payment-intents/route";
import { GET as getPaymentIntent } from "./me/payment-intents/[id]/route";

const originalAllowlist = process.env.PRODUCT_API_ORIGIN_ALLOWLIST;
const principal = {
  canonicalUserId: "7",
  platformUserId: "usr_projection",
  clientId: "dream-bff",
  tokenId: "jti_1",
  scopes: ["product:read", "product:write"],
  tier: "creator",
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PRODUCT_API_ORIGIN_ALLOWLIST = "https://dream.example.test";
  mocks.requirePrincipal.mockResolvedValue(principal);
  mocks.getPlans.mockResolvedValue({
    data: [],
    meta: { total: 0, page: 1, pageSize: 20 },
  });
  mocks.getContext.mockResolvedValue({
    canonicalUser: { id: "7" },
    subscription: null,
    planVersion: null,
    entitlements: [],
    allowance: null,
    asOf: "2030-01-01T00:00:00.000Z",
  });
  mocks.getUsage.mockResolvedValue({
    data: {
      period: null,
      allowance: null,
      summary: {
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
        unknownUsageCount: 0,
      },
      projection: {
        asOf: "2030-01-01T00:00:00.000Z",
        sampleWindowDays: 7,
        projectedExhaustionAt: null,
        projectedTokenShortfall: null,
        confidence: "insufficientData",
      },
      items: [],
    },
    meta: { total: 0, page: 1, pageSize: 25 },
  });
  mocks.getModels.mockResolvedValue({
    items: [],
    asOf: "2030-01-01T00:00:00.000Z",
  });
  mocks.previewCommand.mockResolvedValue({
    action: "pause",
    allowed: true,
    reasonCode: null,
    previewId: `preview_${"a".repeat(22)}`,
    digest: `sha256:${"b".repeat(43)}`,
    expiresAt: "2030-01-01T00:05:00.000Z",
    expectedVersion: 7,
    current: null,
    target: null,
    appliesAt: "2030-01-01T00:00:00.000Z",
    allowanceImpact: {
      unit: "tokens",
      currentPeriodTokens: 100,
      nextPeriodTokens: 100,
      currentPeriodChanges: false,
    },
    entitlementImpact: {
      currentModelAliases: [],
      targetModelAliases: [],
    },
    gatewayImpact: { callableAfterExecute: false },
    warnings: [],
  });
  const payment = {
    id: "pay_1234567890abcdef1234567890abcdef",
    planVersionId: "planv_creator",
    subscriptionId: null,
    operation: "initial_activation",
    amountMicrousd: 9_000_000,
    currency: "USD",
    status: "requires_action",
    nextAction: { type: "test_webhook" },
    failureCode: null,
    createdAt: "2030-01-01T00:00:00.000Z",
    updatedAt: "2030-01-01T00:00:00.000Z",
  };
  mocks.createPaymentIntent.mockResolvedValue(payment);
  mocks.getPaymentIntent.mockResolvedValue(payment);
});

afterEach(() => {
  if (originalAllowlist === undefined) {
    delete process.env.PRODUCT_API_ORIGIN_ALLOWLIST;
  } else {
    process.env.PRODUCT_API_ORIGIN_ALLOWLIST = originalAllowlist;
  }
});

describe("the Product API subscription and payment routes", () => {
  it("serves plans with pagination metadata and read scope", async () => {
    const response = await getPlans(
      new Request("https://admin.test/api/product/v1/plans?page=1&pageSize=20", {
        headers: { "x-request-id": "product_route_1" },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("product_route_1");
    await expect(response.json()).resolves.toEqual({
      data: [],
      meta: { requestId: "product_route_1", total: 0, page: 1, pageSize: 20 },
    });
    expect(mocks.requirePrincipal).toHaveBeenCalledWith(
      expect.any(Request),
      "product:read",
    );
  });

  it("serves subscription context", async () => {
    const response = await getContext(
      new Request("https://admin.test/api/product/v1/me/subscription-context"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data.canonicalUser.id).toBe("7");
  });

  it("serves strict paginated usage", async () => {
    const response = await getUsage(
      new Request("https://admin.test/api/product/v1/me/usage?page=1&pageSize=25"),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).meta).toMatchObject({
      total: 0,
      page: 1,
      pageSize: 25,
    });
  });

  it("serves model catalog", async () => {
    const response = await getModels(
      new Request("https://admin.test/api/product/v1/me/model-catalog"),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { items: [] },
    });
  });

  it("serves preview through the single write-scoped command route", async () => {
    const response = await postCommand(
      new Request(
        "https://admin.test/api/product/v1/me/subscription-commands",
        {
          method: "POST",
          headers: {
            origin: "https://dream.example.test",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            action: "pause",
            phase: "preview",
            expectedVersion: 7,
          }),
        },
      ),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      action: "pause",
      allowed: true,
      allowanceImpact: { unit: "tokens" },
    });
    expect(mocks.requirePrincipal).toHaveBeenCalledWith(
      expect.any(Request),
      "product:write",
    );
  });

  it("creates and reads an idempotent subscription payment intent", async () => {
    const created = await postPaymentIntent(
      new Request("https://admin.test/api/product/v1/me/payment-intents", {
        method: "POST",
        headers: {
          origin: "https://dream.example.test",
          "content-type": "application/json",
          "idempotency-key": "payment-key-123",
        },
        body: JSON.stringify({ planVersionId: "planv_creator" }),
      }),
    );
    expect(created.status).toBe(201);
    expect((await created.json()).data).toMatchObject({
      amountMicrousd: 9_000_000,
      status: "requires_action",
    });
    expect(mocks.createPaymentIntent).toHaveBeenCalledWith(
      principal,
      { planVersionId: "planv_creator" },
      "payment-key-123",
    );

    const read = await getPaymentIntent(
      new Request("https://admin.test/api/product/v1/me/payment-intents/pay_1234567890abcdef1234567890abcdef"),
      { params: Promise.resolve({ id: "pay_1234567890abcdef1234567890abcdef" }) },
    );
    expect(read.status).toBe(200);
    expect(mocks.getPaymentIntent).toHaveBeenCalledWith(
      principal,
      "pay_1234567890abcdef1234567890abcdef",
    );
  });

  it("rejects unknown query identity before calling a read service", async () => {
    const response = await getPlans(
      new Request("https://admin.test/api/product/v1/plans?userId=7"),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("PRODUCT_INPUT_INVALID");
    expect(mocks.getPlans).not.toHaveBeenCalled();
  });

  it("uses the nested Product error envelope without leaking dependency errors", async () => {
    mocks.requirePrincipal.mockRejectedValue(
      new ProductError(
        "PRODUCT_AUTH_REQUIRED",
        "A valid Product API Bearer token is required",
        401,
      ),
    );
    const response = await getContext(
      new Request("https://admin.test/api/product/v1/me/subscription-context", {
        headers: { "x-request-id": "product_error_1" },
      }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PRODUCT_AUTH_REQUIRED",
        message: "A valid Product API Bearer token is required",
      },
      meta: { requestId: "product_error_1" },
    });
  });
});
