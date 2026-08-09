import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProductError } from "./errors";
import {
  issueProductPreviewReceipt,
  verifyProductPreviewReceipt,
} from "./receipts";

const originalSecret = process.env.PRODUCT_API_JWT_SECRET;

beforeEach(() => {
  process.env.PRODUCT_API_JWT_SECRET = "s".repeat(32);
});

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.PRODUCT_API_JWT_SECRET;
  } else {
    process.env.PRODUCT_API_JWT_SECRET = originalSecret;
  }
});

describe("stateless Product preview receipts", () => {
  const input = {
    canonicalUserId: "7",
    clientId: "dream-bff",
    action: "upgrade" as const,
    targetPlanVersionId: "planv_creator_4",
    expectedVersion: 9,
  };
  const now = new Date("2030-01-01T00:00:00.000Z");

  it("binds subject, client, action, target, version, id and expiry", () => {
    const receipt = issueProductPreviewReceipt(input, now);
    expect(receipt.previewId).toMatch(/^preview_[A-Za-z0-9_-]{22}$/);
    expect(receipt.digest).toMatch(/^sha256:[A-Za-z0-9_-]{43}$/);
    expect(() =>
      verifyProductPreviewReceipt(input, receipt, now),
    ).not.toThrow();
    expect(() =>
      verifyProductPreviewReceipt(
        { ...input, canonicalUserId: "8" },
        receipt,
        now,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "SUBSCRIPTION_PREVIEW_INVALID",
        status: 409,
      }),
    );
  });

  it("rejects expired and tampered receipts", () => {
    const receipt = issueProductPreviewReceipt(input, now);
    expect(() =>
      verifyProductPreviewReceipt(
        input,
        receipt,
        new Date("2030-01-01T00:05:00.001Z"),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "SUBSCRIPTION_PREVIEW_EXPIRED",
      }),
    );
    expect(() =>
      verifyProductPreviewReceipt(
        input,
        { ...receipt, digest: `sha256:${"a".repeat(43)}` },
        now,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ProductError>>({
        code: "SUBSCRIPTION_PREVIEW_INVALID",
      }),
    );
  });
});

