import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ProductError } from "../product/errors";
import type {
  PaymentAdapter,
  PaymentAdjustmentResult,
  PaymentWebhookEvent,
} from "./adapter";

const fakeEventSchema = z.strictObject({
  id: z.string().regex(/^evt_test_[A-Za-z0-9_-]{8,100}$/),
  intentId: z.string().regex(/^pi_test_[A-Za-z0-9_-]{16,100}$/),
  type: z.enum([
    "payment.succeeded",
    "payment.failed",
    "payment.cancelled",
    "payment.refunded",
    "payment.reversed",
  ]),
  amountMicrousd: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  currency: z.literal("USD"),
  failureCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,79}$/)
    .nullable()
    .default(null),
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("base64url");
}

function requiredSecret(environment: NodeJS.ProcessEnv) {
  const value = environment.INK_PAYMENT_FAKE_WEBHOOK_SECRET?.trim() ?? "";
  if (Buffer.byteLength(value, "utf8") < 32) {
    throw new ProductError(
      "PAYMENT_ADAPTER_NOT_CONFIGURED",
      "The payment adapter is not safely configured",
      503,
    );
  }
  return value;
}

export class FakePaymentAdapter implements PaymentAdapter {
  readonly code = "fake";
  readonly testOnly = true;
  readonly capabilities = {
    refunds: true,
    reversals: true,
    webhooks: true,
  } as const;

  constructor(private readonly environment: NodeJS.ProcessEnv = process.env) {
    if (
      environment.NODE_ENV !== "test" ||
      environment.INK_PAYMENT_FAKE_ENABLED !== "1"
    ) {
      throw new ProductError(
        "PAYMENT_TEST_ADAPTER_DISABLED",
        "The test payment adapter is disabled outside isolated tests",
        503,
      );
    }
    requiredSecret(environment);
  }

  async createIntent(input: {
    internalIntentId: string;
    idempotencyKey: string;
  }) {
    return {
      externalIntentId: `pi_test_${digest(
        `${input.internalIntentId}:${input.idempotencyKey}`,
      ).slice(0, 32)}`,
      status: "requires_action" as const,
      nextAction: { type: "test_webhook" as const },
    };
  }

  async verifyWebhook(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<PaymentWebhookEvent> {
    const provided = input.headers.get("x-ink-test-signature") ?? "";
    const match = provided.match(/^sha256=([a-f0-9]{64})$/);
    const expected = createHmac("sha256", requiredSecret(this.environment))
      .update(input.rawBody)
      .digest("hex");
    if (
      !match ||
      !timingSafeEqual(Buffer.from(match[1], "hex"), Buffer.from(expected, "hex"))
    ) {
      throw new ProductError(
        "PAYMENT_WEBHOOK_SIGNATURE_INVALID",
        "The payment webhook signature is invalid",
        401,
      );
    }
    let value: unknown;
    try {
      value = JSON.parse(input.rawBody);
    } catch {
      throw new ProductError(
        "PAYMENT_WEBHOOK_INVALID",
        "The payment webhook payload is invalid",
        400,
      );
    }
    const event = fakeEventSchema.parse(value);
    return {
      externalEventId: event.id,
      externalIntentId: event.intentId,
      type: event.type,
      amountMicrousd: event.amountMicrousd,
      currency: event.currency,
      failureCode: event.failureCode,
      summary: {
        type: event.type,
        amountMicrousd: event.amountMicrousd,
        currency: event.currency,
        testOnly: true,
      },
    };
  }

  async refund(input: {
    externalIntentId: string;
    idempotencyKey: string;
  }): Promise<PaymentAdjustmentResult> {
    return {
      externalAdjustmentId: `refund_test_${digest(
        `${input.externalIntentId}:${input.idempotencyKey}`,
      ).slice(0, 24)}`,
      status: "succeeded",
    };
  }

  async reverse(input: {
    externalIntentId: string;
    idempotencyKey: string;
  }): Promise<PaymentAdjustmentResult> {
    return {
      externalAdjustmentId: `reversal_test_${digest(
        `${input.externalIntentId}:${input.idempotencyKey}`,
      ).slice(0, 24)}`,
      status: "succeeded",
    };
  }
}
