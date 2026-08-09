export type PaymentIntentStatus =
  | "requires_action"
  | "processing"
  | "succeeded"
  | "failed"
  | "cancelled";

export type PaymentNextAction =
  | { type: "redirect"; url: string }
  | { type: "test_webhook" }
  | { type: "none" };

export type PaymentAdapterIntent = {
  externalIntentId: string;
  status: PaymentIntentStatus;
  nextAction: PaymentNextAction;
};

export type PaymentWebhookEvent = {
  externalEventId: string;
  externalIntentId: string;
  type:
    | "payment.succeeded"
    | "payment.failed"
    | "payment.cancelled"
    | "payment.refunded"
    | "payment.reversed";
  amountMicrousd: number;
  currency: "USD";
  failureCode: string | null;
  summary: Record<string, string | number | boolean | null>;
};

export type PaymentAdjustmentResult = {
  externalAdjustmentId: string;
  status: "succeeded" | "failed";
};

export interface PaymentAdapter {
  readonly code: string;
  readonly testOnly: boolean;
  readonly capabilities: Readonly<{
    refunds: boolean;
    reversals: boolean;
    webhooks: boolean;
  }>;

  createIntent(input: {
    internalIntentId: string;
    amountMicrousd: number;
    currency: "USD";
    idempotencyKey: string;
    canonicalUserId: string;
    planVersionId: string;
  }): Promise<PaymentAdapterIntent>;

  verifyWebhook(input: {
    rawBody: string;
    headers: Headers;
  }): Promise<PaymentWebhookEvent>;

  refund(input: {
    externalIntentId: string;
    amountMicrousd: number;
    idempotencyKey: string;
    reason: string;
  }): Promise<PaymentAdjustmentResult>;

  reverse(input: {
    externalIntentId: string;
    amountMicrousd: number;
    idempotencyKey: string;
    reason: string;
  }): Promise<PaymentAdjustmentResult>;
}
