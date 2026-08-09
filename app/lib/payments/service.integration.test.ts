import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closePoolForTests, getPool } from "../db";
import { withPlatformTransaction } from "../platform-db";
import type { ProductPrincipal } from "../product/types";
import { activateSubscriptionOnClient } from "../subscriptions/service";
import { FakePaymentAdapter } from "./fake-adapter";
import {
  createProductPaymentIntent,
  getProductPaymentIntent,
  processPaymentWebhook,
} from "./service";

const fakeSecret = "integration-fake-webhook-secret-at-least-thirty-two-bytes";
const adapter = new FakePaymentAdapter({
  NODE_ENV: "test",
  INK_PAYMENT_FAKE_ENABLED: "1",
  INK_PAYMENT_FAKE_WEBHOOK_SECRET: fakeSecret,
} as NodeJS.ProcessEnv);

let principal: ProductPrincipal;
const planVersionId = "planv_payment_r45";

function signedEvent(input: {
  id: string;
  intentId: string;
  type: "payment.succeeded" | "payment.failed" | "payment.refunded";
  amountMicrousd?: number;
  failureCode?: string | null;
}) {
  const rawBody = JSON.stringify({
    id: input.id,
    intentId: input.intentId,
    type: input.type,
    amountMicrousd: input.amountMicrousd ?? 9_000_000,
    currency: "USD",
    failureCode: input.failureCode ?? null,
  });
  const signature = createHmac("sha256", fakeSecret)
    .update(rawBody)
    .digest("hex");
  return {
    rawBody,
    headers: new Headers({ "x-ink-test-signature": `sha256=${signature}` }),
  };
}

describe("subscription payment PostgreSQL integration", () => {
  beforeAll(async () => {
    if (process.env.INK_USE_TEST_DATABASE_URL !== "1") {
      throw new Error("INK_USE_TEST_DATABASE_URL=1 is required");
    }
    const pool = getPool();
    const identity = await pool.query<{
      canonical_user_id: string;
      platform_user_id: string;
      tier: string;
    }>(
      `SELECT canonical_user.id::text AS canonical_user_id,
              platform_user.id AS platform_user_id, platform_user.tier
       FROM users AS canonical_user
       JOIN platform_users AS platform_user
         ON platform_user.source = 'ink-dream'
        AND platform_user.external_user_id = canonical_user.id::text
        AND platform_user.status = 'active'
       WHERE NOT EXISTS (
         SELECT 1 FROM subscriptions AS subscription
         WHERE subscription.platform_user_id = platform_user.id
           AND subscription.status IN ('trial','active','past_due','paused','cancel_at_period_end')
       )
       ORDER BY canonical_user.id ASC
       LIMIT 1`,
    );
    if (!identity.rows[0]) throw new Error("isolated clone has no payable canonical user");
    principal = {
      canonicalUserId: identity.rows[0].canonical_user_id,
      platformUserId: identity.rows[0].platform_user_id,
      clientId: "dream-payment-integration",
      tokenId: "payment-integration-token",
      scopes: ["product:read", "product:write"],
      tier: identity.rows[0].tier,
    };
    await pool.query(
      `INSERT INTO subscription_plans (
         id, code, name, description, currency, status
       ) VALUES ('plan_payment_r45','payment-r45','Payment R45',
                 'Isolated payment integration plan','USD','active')
       ON CONFLICT (id) DO NOTHING`,
    );
    await pool.query(
      `INSERT INTO subscription_plan_versions (
         id, plan_id, version_number, status, billing_period,
         base_price_microusd, trial_days, grace_period_days,
         allowance_tokens, allowance_microusd, overage_policy,
         effective_from, published_at
       ) VALUES ($1,'plan_payment_r45',1,'published','monthly',9000000,
                 0,0,100000,0,'deny',NULL,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [planVersionId],
    );
  });

  afterAll(async () => {
    await closePoolForTests();
  });

  it("does not activate on failure, activates once on success, and revokes on refund", async () => {
    const failed = await createProductPaymentIntent(
      principal,
      { planVersionId },
      "payment-failed-r45",
      { adapter },
    );
    const failedExternal = await getPool().query<{ external_intent_id: string }>(
      "SELECT external_intent_id FROM subscription_payment_intents WHERE id = $1",
      [failed.id],
    );
    const failedEvent = signedEvent({
      id: "evt_test_failed_r45_12345678",
      intentId: failedExternal.rows[0]!.external_intent_id,
      type: "payment.failed",
      failureCode: "CARD_DECLINED",
    });
    await processPaymentWebhook("fake", failedEvent.rawBody, failedEvent.headers, { adapter });
    const failedState = await getProductPaymentIntent(principal, failed.id);
    expect(failedState).toMatchObject({ status: "failed", subscriptionId: null });

    const payment = await createProductPaymentIntent(
      principal,
      { planVersionId },
      "payment-success-r45",
      { adapter },
    );
    expect(payment).toMatchObject({
      operation: "initial_activation",
      amountMicrousd: 9_000_000,
      currency: "USD",
      status: "requires_action",
      subscriptionId: null,
    });
    const external = await getPool().query<{ external_intent_id: string }>(
      "SELECT external_intent_id FROM subscription_payment_intents WHERE id = $1",
      [payment.id],
    );
    const succeededEvent = signedEvent({
      id: "evt_test_success_r45_12345678",
      intentId: external.rows[0]!.external_intent_id,
      type: "payment.succeeded",
    });
    const first = await processPaymentWebhook(
      "fake",
      succeededEvent.rawBody,
      succeededEvent.headers,
      { adapter },
    );
    const replay = await processPaymentWebhook(
      "fake",
      succeededEvent.rawBody,
      succeededEvent.headers,
      { adapter },
    );
    expect(first).toMatchObject({ status: "processed", idempotentReplay: false });
    expect(replay).toMatchObject({ status: "processed", idempotentReplay: true });
    const succeeded = await getProductPaymentIntent(principal, payment.id);
    expect(succeeded.status).toBe("succeeded");
    expect(succeeded.subscriptionId).toMatch(/^sub_/);

    const facts = await getPool().query<{
      subscriptions: string;
      allowances: string;
      webhooks: string;
      events: string;
    }>(
      `SELECT
        (SELECT COUNT(*)::text FROM subscriptions WHERE id = $1) AS subscriptions,
        (SELECT COUNT(*)::text FROM subscription_usage_allowances WHERE subscription_id = $1) AS allowances,
        (SELECT COUNT(*)::text FROM payment_webhook_events WHERE external_event_id = 'evt_test_success_r45_12345678') AS webhooks,
        (SELECT COUNT(*)::text FROM subscription_events WHERE subscription_id = $1 AND event_type = 'activated') AS events`,
      [succeeded.subscriptionId],
    );
    expect(facts.rows[0]).toEqual({
      subscriptions: "1",
      allowances: "1",
      webhooks: "1",
      events: "1",
    });

    const refundEvent = signedEvent({
      id: "evt_test_refund_r45_12345678",
      intentId: external.rows[0]!.external_intent_id,
      type: "payment.refunded",
    });
    await processPaymentWebhook("fake", refundEvent.rawBody, refundEvent.headers, { adapter });
    const refunded = await getProductPaymentIntent(principal, payment.id);
    expect(refunded.status).toBe("refunded");
    const revoked = await getPool().query<{ status: string; adjustment_count: string }>(
      `SELECT subscription.status,
              (SELECT COUNT(*)::text FROM subscription_payment_adjustments
               WHERE payment_intent_id = $2) AS adjustment_count
       FROM subscriptions AS subscription WHERE subscription.id = $1`,
      [succeeded.subscriptionId, payment.id],
    );
    expect(revoked.rows[0]).toEqual({ status: "cancelled", adjustment_count: "1" });
  });

  it("holds a priced period past due and grants the next Token allowance only after one verified renewal", async () => {
    const now = Date.now();
    const periodStart = new Date(now - 62 * 86_400_000);
    const active = await withPlatformTransaction(
      async (client) => await activateSubscriptionOnClient(client, {
        platformUserId: principal.platformUserId,
        planVersionId,
        startsAt: periodStart.toISOString(),
        startInTrial: false,
        idempotencyKey: "admin-paid-renewal-fixture-r46",
        reason: "Isolated paid renewal fixture",
        actor: { type: "admin", id: "payment-integration" },
      }),
    );

    const renewal = await createProductPaymentIntent(
      principal,
      { planVersionId },
      "payment-renewal-r46",
      { adapter },
    );
    expect(renewal).toMatchObject({
      operation: "renewal",
      subscriptionId: active.id,
      status: "requires_action",
    });
    const duplicate = await createProductPaymentIntent(
      principal,
      { planVersionId },
      "payment-renewal-r46-another-click",
      { adapter },
    );
    expect(duplicate.id).toBe(renewal.id);

    const held = await getPool().query<{ status: string; allowances: string }>(
      `SELECT subscription.status,
              (SELECT COUNT(*)::text FROM subscription_usage_allowances
               WHERE subscription_id = subscription.id) AS allowances
       FROM subscriptions AS subscription WHERE subscription.id = $1`,
      [active.id],
    );
    expect(held.rows[0]).toEqual({ status: "past_due", allowances: "1" });

    const renewalExternal = await getPool().query<{ external_intent_id: string }>(
      "SELECT external_intent_id FROM subscription_payment_intents WHERE id = $1",
      [renewal.id],
    );
    const renewalEvent = signedEvent({
      id: "evt_test_renewal_success_r46",
      intentId: renewalExternal.rows[0]!.external_intent_id,
      type: "payment.succeeded",
    });
    const first = await processPaymentWebhook(
      "fake",
      renewalEvent.rawBody,
      renewalEvent.headers,
      { adapter },
    );
    const replay = await processPaymentWebhook(
      "fake",
      renewalEvent.rawBody,
      renewalEvent.headers,
      { adapter },
    );
    expect(first.idempotentReplay).toBe(false);
    expect(replay.idempotentReplay).toBe(true);

    const renewed = await getPool().query<{
      status: string;
      allowances: string;
      renewals: string;
      payment_required: string;
    }>(
      `SELECT subscription.status,
              (SELECT COUNT(*)::text FROM subscription_usage_allowances
               WHERE subscription_id = subscription.id) AS allowances,
              (SELECT COUNT(*)::text FROM subscription_events
               WHERE subscription_id = subscription.id AND event_type = 'renew') AS renewals,
              (SELECT COUNT(*)::text FROM subscription_events
               WHERE subscription_id = subscription.id
                 AND event_type = 'period_boundary'
                 AND metadata->>'outcome' = 'payment_required') AS payment_required
       FROM subscriptions AS subscription WHERE subscription.id = $1`,
      [active.id],
    );
    expect(renewed.rows[0]).toEqual({
      status: "active",
      allowances: "2",
      renewals: "1",
      payment_required: "1",
    });
  });
});
