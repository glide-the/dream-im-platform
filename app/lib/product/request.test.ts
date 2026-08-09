import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { ProductError } from "./errors";
import {
  assertNoProductUserOverride,
  assertProductOrigin,
  parseStrictJson,
  parseStrictQuery,
  productIdempotencyKey,
  productRequestId,
} from "./request";

const originalAllowlist = process.env.PRODUCT_API_ORIGIN_ALLOWLIST;

afterEach(() => {
  if (originalAllowlist === undefined) {
    delete process.env.PRODUCT_API_ORIGIN_ALLOWLIST;
  } else {
    process.env.PRODUCT_API_ORIGIN_ALLOWLIST = originalAllowlist;
  }
});

describe("Product API request boundary", () => {
  it("uses one validated request ID for the full response lifecycle", () => {
    const supplied = new Request("https://admin.test/api/product/v1/plans", {
      headers: { "x-request-id": "dream-request_7" },
    });
    expect(productRequestId(supplied)).toBe("dream-request_7");
    expect(
      productRequestId(
        new Request("https://admin.test/api/product/v1/plans", {
          headers: { "x-request-id": "invalid request id" },
        }),
      ),
    ).toMatch(/^product_[a-f0-9]{32}$/);
  });

  it("requires an explicitly allowlisted Origin for mutations", () => {
    process.env.PRODUCT_API_ORIGIN_ALLOWLIST = "https://dream.example.test";
    expect(() =>
      assertProductOrigin(
        new Request("https://admin.example.test/api/product/v1/me/commands", {
          method: "POST",
          headers: { origin: "https://dream.example.test" },
        }),
        true,
      ),
    ).not.toThrow();
    expect(() =>
      assertProductOrigin(
        new Request("https://admin.example.test/api/product/v1/me/commands", {
          method: "POST",
          headers: { origin: "https://attacker.example.test" },
        }),
        true,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "PRODUCT_ORIGIN_DENIED",
        status: 403,
      }),
    );
    expect(() =>
      assertProductOrigin(
        new Request("https://admin.example.test/api/product/v1/me/commands", {
          method: "POST",
        }),
        true,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "PRODUCT_ORIGIN_REQUIRED",
      }),
    );
  });

  it("rejects all caller-controlled user identity headers", () => {
    expect(() =>
      assertNoProductUserOverride(
        new Request("https://admin.test/api/product/v1/plans", {
          headers: { "x-platform-user-id": "usr_attacker" },
        }),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "PRODUCT_USER_OVERRIDE_DENIED",
      }),
    );
  });

  it("parses strict non-repeated query parameters", () => {
    const schema = z.strictObject({ page: z.coerce.number().int() });
    expect(
      parseStrictQuery(
        new Request("https://admin.test/path?page=2"),
        schema,
      ),
    ).toEqual({ page: 2 });
    expect(() =>
      parseStrictQuery(
        new Request("https://admin.test/path?page=1&page=2"),
        schema,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "PRODUCT_INPUT_INVALID",
      }),
    );
  });

  it("requires strict JSON and execute-only idempotency keys", async () => {
    const schema = z.strictObject({ value: z.string() });
    await expect(
      parseStrictJson(
        new Request("https://admin.test/path", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: "safe", userId: "7" }),
        }),
        schema,
      ),
    ).rejects.toThrow();
    const execute = new Request("https://admin.test/path", {
      headers: { "idempotency-key": "command.retry-1" },
    });
    expect(productIdempotencyKey(execute, true)).toBe("command.retry-1");
    expect(() => productIdempotencyKey(execute, false)).toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "PRODUCT_IDEMPOTENCY_KEY_NOT_ALLOWED",
      }),
    );
  });

  it("maps media type, malformed length, and oversized bodies consistently", async () => {
    const schema = z.strictObject({ value: z.string() });
    const parse = (headers: HeadersInit, body = JSON.stringify({ value: "ok" })) =>
      parseStrictJson(
        new Request("https://admin.test/path", {
          method: "POST",
          headers,
          body,
        }),
        schema,
      );

    await expect(parse({ "content-type": "text/plain" })).rejects.toMatchObject({
      code: "PRODUCT_JSON_REQUIRED",
      status: 415,
    });
    await expect(
      parse({ "content-type": "application/json", "content-length": "invalid" }),
    ).rejects.toMatchObject({ code: "PRODUCT_INPUT_INVALID", status: 400 });
    await expect(
      parse({ "content-type": "application/json", "content-length": "16385" }),
    ).rejects.toMatchObject({ code: "PRODUCT_BODY_TOO_LARGE", status: 413 });
  });
});
