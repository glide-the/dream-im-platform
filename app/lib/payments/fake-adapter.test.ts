import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { FakePaymentAdapter } from "./fake-adapter";

const secret = "fake-webhook-secret-with-at-least-thirty-two-bytes";
const environment = {
  NODE_ENV: "test",
  INK_PAYMENT_FAKE_ENABLED: "1",
  INK_PAYMENT_FAKE_WEBHOOK_SECRET: secret,
} as NodeJS.ProcessEnv;

describe("FakePaymentAdapter", () => {
  it("is deterministic and never returns a provider secret", async () => {
    const adapter = new FakePaymentAdapter(environment);
    const input = {
      internalIntentId: "pay_1234567890abcdef1234567890abcdef",
      amountMicrousd: 9_000_000,
      currency: "USD" as const,
      idempotencyKey: "payment-key-123",
      canonicalUserId: "7",
      planVersionId: "planv_creator",
    };
    const first = await adapter.createIntent(input);
    const second = await adapter.createIntent(input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "requires_action",
      nextAction: { type: "test_webhook" },
    });
    expect(JSON.stringify(first)).not.toMatch(/secret|credential|api.?key/i);
  });

  it("verifies signatures and returns only a sanitized event summary", async () => {
    const adapter = new FakePaymentAdapter(environment);
    const rawBody = JSON.stringify({
      id: "evt_test_payment_12345678",
      intentId: "pi_test_1234567890abcdef",
      type: "payment.succeeded",
      amountMicrousd: 9_000_000,
      currency: "USD",
      failureCode: null,
    });
    const signature = createHmac("sha256", secret).update(rawBody).digest("hex");
    const event = await adapter.verifyWebhook({
      rawBody,
      headers: new Headers({ "x-ink-test-signature": `sha256=${signature}` }),
    });
    expect(event).toMatchObject({
      externalEventId: "evt_test_payment_12345678",
      type: "payment.succeeded",
      amountMicrousd: 9_000_000,
      summary: { testOnly: true },
    });
    expect(JSON.stringify(event)).not.toContain(secret);
  });

  it("fails closed outside the explicit test environment", () => {
    expect(() => new FakePaymentAdapter({
      NODE_ENV: "production",
      INK_PAYMENT_FAKE_ENABLED: "1",
      INK_PAYMENT_FAKE_WEBHOOK_SECRET: secret,
    } as NodeJS.ProcessEnv)).toThrowError(
      expect.objectContaining({ code: "PAYMENT_TEST_ADAPTER_DISABLED" }),
    );
  });
});
