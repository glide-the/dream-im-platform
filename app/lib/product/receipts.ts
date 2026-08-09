import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { ProductError } from "./errors";
import type { ProductAction } from "./types";

const previewLifetimeMilliseconds = 5 * 60 * 1_000;

export type ProductPreviewReceiptInput = {
  canonicalUserId: string;
  clientId: string;
  action: ProductAction;
  targetPlanVersionId?: string;
  expectedVersion: number | null;
};

export type ProductPreviewReceipt = {
  previewId: string;
  digest: string;
  expiresAt: string;
};

function previewSigningKey() {
  const value = process.env.PRODUCT_API_JWT_SECRET;
  if (!value || new TextEncoder().encode(value).byteLength < 32) {
    throw new ProductError(
      "PRODUCT_AUTH_NOT_CONFIGURED",
      "Product API authentication is not configured",
      503,
    );
  }
  return createHmac("sha256", value)
    .update("ink-memory-product-preview-v1")
    .digest();
}

function receiptPayload(
  input: ProductPreviewReceiptInput,
  receipt: Pick<ProductPreviewReceipt, "previewId" | "expiresAt">,
) {
  return JSON.stringify({
    version: 1,
    subject: input.canonicalUserId,
    clientId: input.clientId,
    action: input.action,
    targetPlanVersionId: input.targetPlanVersionId ?? null,
    expectedVersion: input.expectedVersion,
    previewId: receipt.previewId,
    expiresAt: receipt.expiresAt,
  });
}

function digest(
  input: ProductPreviewReceiptInput,
  receipt: Pick<ProductPreviewReceipt, "previewId" | "expiresAt">,
) {
  return `sha256:${createHmac("sha256", previewSigningKey())
    .update(receiptPayload(input, receipt))
    .digest("base64url")}`;
}

export function issueProductPreviewReceipt(
  input: ProductPreviewReceiptInput,
  now = new Date(),
): ProductPreviewReceipt {
  const previewId = `preview_${randomBytes(16).toString("base64url")}`;
  const expiresAt = new Date(
    now.getTime() + previewLifetimeMilliseconds,
  ).toISOString();
  return {
    previewId,
    expiresAt,
    digest: digest(input, { previewId, expiresAt }),
  };
}

export function verifyProductPreviewReceipt(
  input: ProductPreviewReceiptInput,
  receipt: ProductPreviewReceipt,
  now = new Date(),
) {
  const expiresAt = Date.parse(receipt.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    throw new ProductError(
      "SUBSCRIPTION_PREVIEW_EXPIRED",
      "The subscription preview has expired; create a new preview",
      409,
    );
  }
  const expected = digest(input, receipt);
  const suppliedBuffer = Buffer.from(receipt.digest);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.byteLength !== expectedBuffer.byteLength ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    throw new ProductError(
      "SUBSCRIPTION_PREVIEW_INVALID",
      "The subscription preview receipt is invalid; create a new preview",
      409,
    );
  }
}

