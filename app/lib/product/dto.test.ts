import { describe, expect, it } from "vitest";
import {
  assertProductDtoSafe,
  productSuccessResponse,
} from "./dto";
import { ProductError } from "./errors";
import { PRODUCT_FORBIDDEN_KEY_FRAGMENTS } from "./safety";

describe("Product DTO firewall", () => {
  it.each([
    "cashBalance",
    "monetaryBalance",
    "financialLedgerEntries",
    "effectiveFrom",
    "platformUserId",
    "providerName",
    "apiKeyCiphertext",
    "clientSecret",
  ])("rejects forbidden nested field %s", (field) => {
    expect(() =>
      assertProductDtoSafe({ data: { nested: [{ [field]: "unsafe" }] } }),
    ).toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "PRODUCT_RESPONSE_INVALID",
      }),
    );
  });

  it("uses the exact Token-only firewall while permitting Token balance fields", () => {
    expect(PRODUCT_FORBIDDEN_KEY_FRAGMENTS).toEqual([
      "cash",
      "monetary",
      "financial",
      "topup",
      "ledger",
      "effectivefrom",
      "effectiveto",
      "provider",
      "secret",
      "credential",
      "platformuserid",
      "authorization",
      "apikey",
      "keyhash",
      "ciphertext",
    ]);
    expect(() =>
      assertProductDtoSafe({
        tokenBalance: { remainingTokens: 100 },
        payment: { amountMicrousd: 9_000_000, currency: "USD" },
      }),
    ).not.toThrow();
  });

  it("keeps request ID and ETag stable across body and headers", async () => {
    const first = productSuccessResponse({
      data: { allowance: { unit: "tokens", remaining: 10 } },
      requestId: "product_request_1",
      subject: "7",
      request: new Request("https://admin.test/api/product/v1/plans"),
      meta: { total: 1, page: 1, pageSize: 20 },
    });
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^"product-[A-Za-z0-9_-]{43}"$/);
    expect(first.headers.get("x-request-id")).toBe("product_request_1");
    await expect(first.json()).resolves.toMatchObject({
      meta: { requestId: "product_request_1", total: 1 },
    });

    const revalidated = productSuccessResponse({
      data: { allowance: { unit: "tokens", remaining: 10 } },
      requestId: "product_request_2",
      subject: "7",
      request: new Request("https://admin.test/api/product/v1/plans", {
        headers: { "if-none-match": etag! },
      }),
      meta: { total: 1, page: 1, pageSize: 20 },
    });
    expect(revalidated.status).toBe(304);
    expect(revalidated.headers.get("x-request-id")).toBe("product_request_2");
  });
});
