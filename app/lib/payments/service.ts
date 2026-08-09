import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { createPlatformId } from "../platform-ids";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { ProductError } from "../product/errors";
import type { ProductPrincipal } from "../product/types";
import {
  activateSubscriptionOnClient,
  advanceSubscriptionPeriodOnClient,
  transitionSubscriptionOnClient,
} from "../subscriptions/service";
import type { PaymentAdapter, PaymentWebhookEvent } from "./adapter";
import { configuredPaymentAdapter } from "./registry";

type PaymentIntentRow = {
  id: string;
  platform_user_id: string;
  plan_version_id: string;
  subscription_id: string | null;
  operation: "initial_activation" | "renewal";
  expected_subscription_version: number | null;
  expected_period_end: Date | null;
  adapter_code: string;
  external_intent_id: string | null;
  amount_microusd: string | number;
  currency: "USD";
  status:
    | "creating"
    | "requires_action"
    | "processing"
    | "succeeded"
    | "failed"
    | "cancelled"
    | "refunded"
    | "reversed";
  idempotency_key: string;
  client_id: string;
  next_action: Record<string, unknown>;
  failure_code: string | null;
  created_at: Date;
  updated_at: Date;
  succeeded_at: Date | null;
};

export type ProductPaymentIntentDto = {
  id: string;
  planVersionId: string;
  subscriptionId: string | null;
  operation: PaymentIntentRow["operation"];
  amountMicrousd: number;
  currency: "USD";
  status: PaymentIntentRow["status"];
  nextAction:
    | { type: "redirect"; url: string }
    | { type: "test_webhook" }
    | { type: "none" };
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type Dependencies = {
  adapter?: PaymentAdapter;
};

function safeInteger(value: string | number, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ProductError(
      "PAYMENT_DATA_INVALID",
      `The payment ${field} is invalid`,
      503,
    );
  }
  return parsed;
}

function safeNextAction(value: Record<string, unknown>): ProductPaymentIntentDto["nextAction"] {
  if (value.type === "none") return { type: "none" };
  if (value.type === "test_webhook") return { type: "test_webhook" };
  if (
    value.type === "redirect" &&
    typeof value.url === "string" &&
    value.url.length <= 2_048
  ) {
    const url = new URL(value.url);
    if (url.protocol === "https:") return { type: "redirect", url: url.toString() };
  }
  throw new ProductError(
    "PAYMENT_DATA_INVALID",
    "The payment next action is invalid",
    503,
  );
}

function dto(row: PaymentIntentRow): ProductPaymentIntentDto {
  return {
    id: row.id,
    planVersionId: row.plan_version_id,
    subscriptionId: row.subscription_id,
    operation: row.operation,
    amountMicrousd: safeInteger(row.amount_microusd, "amount"),
    currency: row.currency,
    status: row.status,
    nextAction: safeNextAction(row.next_action),
    failureCode: row.failure_code,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function findIntent(
  client: PoolClient,
  id: string,
  platformUserId?: string,
  lock = false,
) {
  const result = await client.query<PaymentIntentRow>(
    `SELECT id, platform_user_id, plan_version_id, subscription_id,
            operation, expected_subscription_version, expected_period_end,
            adapter_code, external_intent_id, amount_microusd, currency,
            status, idempotency_key, client_id, next_action, failure_code,
            created_at, updated_at, succeeded_at
     FROM subscription_payment_intents
     WHERE id = $1
       AND ($2::text IS NULL OR platform_user_id = $2)
     ${lock ? "FOR UPDATE" : ""}`,
    [id, platformUserId ?? null],
  );
  return result.rows[0] ?? null;
}

async function assertPrincipalProjection(
  client: PoolClient,
  principal: ProductPrincipal,
) {
  const result = await client.query<{ canonical_user_id: string }>(
    `SELECT canonical_user.id::text AS canonical_user_id
     FROM users AS canonical_user
     JOIN platform_users AS platform_user
       ON platform_user.source = 'ink-dream'
      AND platform_user.external_user_id = canonical_user.id::text
     WHERE canonical_user.id = $1::bigint
       AND platform_user.id = $2
       AND platform_user.status = 'active'
     FOR SHARE OF canonical_user, platform_user`,
    [principal.canonicalUserId, principal.platformUserId],
  );
  if (result.rows[0]?.canonical_user_id !== principal.canonicalUserId) {
    throw new ProductError(
      "CANONICAL_USER_REQUIRED",
      "The authenticated canonical user has no active billing identity",
      403,
    );
  }
}

async function loadPayablePlan(client: PoolClient, planVersionId: string) {
  const result = await client.query<{
    id: string;
    amount_microusd: string | number;
    currency: "USD";
  }>(
    `SELECT version.id, version.base_price_microusd AS amount_microusd,
            plan.currency
     FROM subscription_plan_versions AS version
     JOIN subscription_plans AS plan ON plan.id = version.plan_id
     WHERE version.id = $1
       AND version.status = 'published'
       AND plan.status = 'active'
       AND version.billing_period = 'monthly'
       AND version.allowance_tokens > 0
       AND version.allowance_microusd = 0
       AND version.overage_policy = 'deny'
       AND version.effective_from IS NULL
       AND version.base_price_microusd > 0
     FOR SHARE OF version, plan`,
    [planVersionId],
  );
  if (!result.rows[0]) {
    throw new ProductError(
      "PAYMENT_PLAN_NOT_PAYABLE",
      "The selected monthly Token plan is not payable",
      409,
    );
  }
  return result.rows[0];
}

export async function createProductPaymentIntent(
  principal: ProductPrincipal,
  input: { planVersionId: string },
  idempotencyKey: string,
  dependencies: Dependencies = {},
) {
  const adapter = dependencies.adapter ?? configuredPaymentAdapter();
  const prepared = await withPlatformTransaction(async (client) => {
    await assertPrincipalProjection(client, principal);
    const existing = await client.query<PaymentIntentRow>(
      `SELECT id, platform_user_id, plan_version_id, subscription_id,
              operation, expected_subscription_version, expected_period_end,
              adapter_code, external_intent_id, amount_microusd, currency,
              status, idempotency_key, client_id, next_action, failure_code,
              created_at, updated_at, succeeded_at
       FROM subscription_payment_intents
       WHERE platform_user_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [principal.platformUserId, idempotencyKey],
    );
    if (existing.rows[0]) {
      if (
        existing.rows[0].plan_version_id !== input.planVersionId ||
        existing.rows[0].client_id !== principal.clientId
      ) {
        throw new ProductError(
          "IDEMPOTENCY_CONFLICT",
          "The idempotency key was already used for another payment",
          409,
        );
      }
      return { row: existing.rows[0], create: false };
    }
    type CurrentSubscription = {
      id: string;
      plan_version_id: string;
      pending_plan_version_id: string | null;
      status: string;
      current_period_number: number;
      current_period_end: Date;
      version: number;
    };
    const currentResult = await client.query<CurrentSubscription>(
      `SELECT id, plan_version_id, pending_plan_version_id, status,
              current_period_number, current_period_end, version
       FROM subscriptions
       WHERE platform_user_id = $1
         AND status IN ('trial', 'active', 'past_due', 'paused', 'cancel_at_period_end')
       LIMIT 1 FOR UPDATE`,
      [principal.platformUserId],
    );
    let current = currentResult.rows[0] ?? null;
    let operation: PaymentIntentRow["operation"] = "initial_activation";
    let expectedSubscriptionVersion: number | null = null;
    let expectedPeriodEnd: Date | null = null;
    let subscriptionId: string | null = null;

    if (current) {
      const targetVersionId = current.pending_plan_version_id ?? current.plan_version_id;
      if (input.planVersionId !== targetVersionId) {
        throw new ProductError(
          "PAYMENT_PLAN_CONFLICT",
          "The payment plan does not match the due subscription version",
          409,
        );
      }
      const now = new Date();
      if (now < current.current_period_end) {
        throw new ProductError(
          "SUBSCRIPTION_PAYMENT_NOT_DUE",
          "The monthly subscription payment is not due",
          409,
          { periodEnd: current.current_period_end.toISOString() },
        );
      }
      if (["active", "trial"].includes(current.status)) {
        const advanced = await advanceSubscriptionPeriodOnClient(client, {
          id: current.id,
          expectedVersion: current.version,
          expectedPeriodEnd: current.current_period_end,
          at: now,
          idempotencyKey: [
            "payment-period",
            current.id,
            current.current_period_number + 1,
            current.current_period_end.toISOString(),
          ].join(":"),
        });
        if (advanced.outcome !== "payment_required") {
          throw new ProductError(
            "PAYMENT_PLAN_NOT_PAYABLE",
            "The due monthly subscription does not require payment",
            409,
          );
        }
        const refreshed = await client.query<CurrentSubscription>(
          `SELECT id, plan_version_id, pending_plan_version_id, status,
                  current_period_number, current_period_end, version
           FROM subscriptions WHERE id = $1 FOR UPDATE`,
          [current.id],
        );
        current = refreshed.rows[0] ?? null;
      }
      if (!current || current.status !== "past_due") {
        throw new ProductError(
          "SUBSCRIPTION_PAYMENT_STATE_CONFLICT",
          "The monthly subscription is not awaiting payment",
          409,
        );
      }
      operation = "renewal";
      subscriptionId = current.id;
      expectedSubscriptionVersion = current.version;
      expectedPeriodEnd = current.current_period_end;

      const live = await client.query<PaymentIntentRow>(
        `SELECT id, platform_user_id, plan_version_id, subscription_id,
                operation, expected_subscription_version, expected_period_end,
                adapter_code, external_intent_id, amount_microusd, currency,
                status, idempotency_key, client_id, next_action, failure_code,
                created_at, updated_at, succeeded_at
         FROM subscription_payment_intents
         WHERE subscription_id = $1 AND expected_period_end = $2
           AND operation = 'renewal'
           AND status IN ('creating', 'requires_action', 'processing', 'succeeded')
         LIMIT 1 FOR UPDATE`,
        [current.id, current.current_period_end],
      );
      if (live.rows[0]) return { row: live.rows[0], create: false };
    }
    const plan = await loadPayablePlan(client, input.planVersionId);
    const amount = safeInteger(plan.amount_microusd, "amount");
    const id = createPlatformId("pay");
    const inserted = await client.query<PaymentIntentRow>(
      `INSERT INTO subscription_payment_intents (
         id, platform_user_id, plan_version_id, subscription_id, operation,
         expected_subscription_version, expected_period_end, adapter_code,
         amount_microusd, currency, status, idempotency_key, client_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'creating',$11,$12)
       RETURNING id, platform_user_id, plan_version_id, subscription_id,
                 operation, expected_subscription_version, expected_period_end,
                 adapter_code, external_intent_id, amount_microusd, currency,
                 status, idempotency_key, client_id, next_action, failure_code,
                 created_at, updated_at, succeeded_at`,
      [
        id,
        principal.platformUserId,
        input.planVersionId,
        subscriptionId,
        operation,
        expectedSubscriptionVersion,
        expectedPeriodEnd,
        adapter.code,
        amount,
        plan.currency,
        idempotencyKey,
        principal.clientId,
      ],
    );
    return { row: inserted.rows[0]!, create: true };
  });
  if (!prepared.create) return dto(prepared.row);

  try {
    const adapterIntent = await adapter.createIntent({
      internalIntentId: prepared.row.id,
      amountMicrousd: safeInteger(prepared.row.amount_microusd, "amount"),
      currency: prepared.row.currency,
      idempotencyKey,
      canonicalUserId: principal.canonicalUserId,
      planVersionId: input.planVersionId,
    });
    const completed = await withPlatformTransaction(async (client) => {
      const locked = await findIntent(client, prepared.row.id, principal.platformUserId, true);
      if (!locked) throw new ProductError("PAYMENT_INTENT_NOT_FOUND", "The payment intent does not exist", 404);
      if (locked.status !== "creating") return locked;
      const updated = await client.query<PaymentIntentRow>(
        `UPDATE subscription_payment_intents
         SET external_intent_id = $2, status = $3, next_action = $4,
             updated_at = NOW()
         WHERE id = $1
         RETURNING id, platform_user_id, plan_version_id, subscription_id,
                   operation, expected_subscription_version, expected_period_end,
                   adapter_code, external_intent_id, amount_microusd, currency,
                   status, idempotency_key, client_id, next_action, failure_code,
                   created_at, updated_at, succeeded_at`,
        [prepared.row.id, adapterIntent.externalIntentId, adapterIntent.status, adapterIntent.nextAction],
      );
      return updated.rows[0]!;
    });
    return dto(completed);
  } catch (error) {
    await withPlatformClient(async (client) => {
      await client.query(
        `UPDATE subscription_payment_intents
         SET status = 'failed', failure_code = 'ADAPTER_CREATE_FAILED',
             next_action = '{}'::jsonb, updated_at = NOW()
         WHERE id = $1 AND status = 'creating'`,
        [prepared.row.id],
      );
    }).catch(() => undefined);
    throw error;
  }
}

export async function getProductPaymentIntent(
  principal: ProductPrincipal,
  id: string,
) {
  return await withPlatformClient(async (client) => {
    const row = await findIntent(client, id, principal.platformUserId);
    if (!row) {
      throw new ProductError(
        "PAYMENT_INTENT_NOT_FOUND",
        "The payment intent does not exist",
        404,
      );
    }
    return dto(row);
  });
}

async function revokeSubscriptionForAdjustment(
  client: PoolClient,
  intent: PaymentIntentRow,
  event: PaymentWebhookEvent,
) {
  if (!intent.subscription_id) return;
  const before = await client.query<Record<string, unknown>>(
    `SELECT * FROM subscriptions WHERE id = $1 FOR UPDATE`,
    [intent.subscription_id],
  );
  if (!before.rows[0]) return;
  await client.query(
    `UPDATE subscriptions
     SET status = 'cancelled', renewal_enabled = FALSE,
         cancelled_at = COALESCE(cancelled_at, NOW()), version = version + 1,
         updated_at = NOW()
     WHERE id = $1 AND status <> 'cancelled'`,
    [intent.subscription_id],
  );
  const after = await client.query<Record<string, unknown>>(
    `SELECT * FROM subscriptions WHERE id = $1`,
    [intent.subscription_id],
  );
  await client.query(
    `INSERT INTO subscription_events (
       id, subscription_id, event_type, idempotency_key, actor_type,
       actor_id, reason, before, after, metadata
     ) VALUES ($1,$2,$3,$4,'payment_adapter',$5,$6,$7,$8,$9)
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      createPlatformId("subevt"),
      intent.subscription_id,
      event.type === "payment.refunded" ? "payment_refunded" : "payment_reversed",
      `payment:${intent.adapter_code}:${event.externalEventId}:subscription`,
      intent.adapter_code,
      event.type,
      before.rows[0],
      after.rows[0] ?? before.rows[0],
      { paymentIntentId: intent.id, amountMicrousd: event.amountMicrousd },
    ],
  );
}

export async function processPaymentWebhook(
  adapterCode: string,
  rawBody: string,
  headers: Headers,
  dependencies: Dependencies = {},
) {
  const adapter = dependencies.adapter ?? configuredPaymentAdapter();
  if (adapter.code !== adapterCode) {
    throw new ProductError(
      "PAYMENT_ADAPTER_MISMATCH",
      "The payment webhook adapter is unavailable",
      404,
    );
  }
  const event = await adapter.verifyWebhook({ rawBody, headers });
  const payloadSha256 = createHash("sha256").update(rawBody).digest("hex");
  return await withPlatformTransaction(async (client) => {
    const eventId = createPlatformId("payevt");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO payment_webhook_events (
         id, adapter_code, external_event_id, event_type, payload_sha256,
         payload_summary, signature_verified
       ) VALUES ($1,$2,$3,$4,$5,$6,TRUE)
       ON CONFLICT (adapter_code, external_event_id) DO NOTHING
       RETURNING id`,
      [eventId, adapter.code, event.externalEventId, event.type, payloadSha256, event.summary],
    );
    if (!inserted.rows[0]) {
      const existing = await client.query<{ processing_status: string; payment_intent_id: string | null }>(
        `SELECT processing_status, payment_intent_id
         FROM payment_webhook_events
         WHERE adapter_code = $1 AND external_event_id = $2`,
        [adapter.code, event.externalEventId],
      );
      return {
        accepted: true,
        idempotentReplay: true,
        status: existing.rows[0]?.processing_status ?? "processed",
        paymentIntentId: existing.rows[0]?.payment_intent_id ?? null,
      };
    }
    const intentResult = await client.query<PaymentIntentRow>(
      `SELECT id, platform_user_id, plan_version_id, subscription_id,
              operation, expected_subscription_version, expected_period_end,
              adapter_code, external_intent_id, amount_microusd, currency,
              status, idempotency_key, client_id, next_action, failure_code,
              created_at, updated_at, succeeded_at
       FROM subscription_payment_intents
       WHERE adapter_code = $1 AND external_intent_id = $2
       FOR UPDATE`,
      [adapter.code, event.externalIntentId],
    );
    const intent = intentResult.rows[0];
    if (!intent) {
      await client.query(
        `UPDATE payment_webhook_events
         SET processing_status = 'rejected', error_code = 'PAYMENT_INTENT_NOT_FOUND',
             processed_at = NOW()
         WHERE id = $1`,
        [eventId],
      );
      return { accepted: true, idempotentReplay: false, status: "rejected", paymentIntentId: null };
    }
    if (
      safeInteger(intent.amount_microusd, "amount") !== event.amountMicrousd ||
      intent.currency !== event.currency
    ) {
      await client.query(
        `UPDATE payment_webhook_events
         SET payment_intent_id = $2, processing_status = 'rejected',
             error_code = 'PAYMENT_AMOUNT_MISMATCH', processed_at = NOW()
         WHERE id = $1`,
        [eventId, intent.id],
      );
      return { accepted: true, idempotentReplay: false, status: "rejected", paymentIntentId: intent.id };
    }

    if (event.type === "payment.succeeded" && intent.status !== "succeeded") {
      if (!["creating", "requires_action", "processing"].includes(intent.status)) {
        throw new ProductError("PAYMENT_STATE_CONFLICT", "The payment state cannot succeed", 409);
      }
      let subscriptionId: string;
      if (intent.operation === "renewal") {
        if (
          !intent.subscription_id ||
          intent.expected_subscription_version === null ||
          intent.expected_period_end === null
        ) {
          throw new ProductError(
            "PAYMENT_DATA_INVALID",
            "The renewal payment binding is invalid",
            503,
          );
        }
        const renewal = await transitionSubscriptionOnClient(client, {
          id: intent.subscription_id,
          platformUserId: intent.platform_user_id,
          action: "renew",
          expectedVersion: intent.expected_subscription_version,
          idempotencyKey: `payment:${adapter.code}:${event.externalEventId}:renew`,
          reason: "Verified monthly subscription renewal",
          actor: { type: "payment_adapter", id: adapter.code },
        });
        subscriptionId = renewal.subscriptionId;
      } else {
        const activation = await activateSubscriptionOnClient(client, {
          platformUserId: intent.platform_user_id,
          planVersionId: intent.plan_version_id,
          startInTrial: false,
          idempotencyKey: `payment:${adapter.code}:${event.externalEventId}:activate`,
          reason: "Verified subscription payment",
          actor: { type: "payment_adapter", id: adapter.code },
        });
        subscriptionId = activation.id;
      }
      await client.query(
        `UPDATE subscription_payment_intents
         SET status = 'succeeded', subscription_id = $2, succeeded_at = NOW(),
             next_action = '{"type":"none"}'::jsonb, failure_code = NULL,
             updated_at = NOW()
         WHERE id = $1`,
        [intent.id, subscriptionId],
      );
    } else if (event.type === "payment.failed" || event.type === "payment.cancelled") {
      await client.query(
        `UPDATE subscription_payment_intents
         SET status = $2, failure_code = $3,
             next_action = '{"type":"none"}'::jsonb, updated_at = NOW()
         WHERE id = $1 AND status <> 'succeeded'`,
        [intent.id, event.type === "payment.failed" ? "failed" : "cancelled", event.failureCode],
      );
    } else if (event.type === "payment.refunded" || event.type === "payment.reversed") {
      if (!intent.subscription_id || !["succeeded", "refunded", "reversed"].includes(intent.status)) {
        throw new ProductError("PAYMENT_STATE_CONFLICT", "The payment cannot be adjusted", 409);
      }
      const adjustmentType = event.type === "payment.refunded" ? "refund" : "reversal";
      await client.query(
        `INSERT INTO subscription_payment_adjustments (
           id, payment_intent_id, adjustment_type, amount_microusd, status,
           external_adjustment_id, idempotency_key, reason
         ) VALUES ($1,$2,$3,$4,'succeeded',$5,$6,$7)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [
          createPlatformId("payadj"),
          intent.id,
          adjustmentType,
          event.amountMicrousd,
          event.externalEventId,
          `payment:${adapter.code}:${event.externalEventId}:adjustment`,
          event.type,
        ],
      );
      await revokeSubscriptionForAdjustment(client, intent, event);
      await client.query(
        `UPDATE subscription_payment_intents
         SET status = $2, updated_at = NOW() WHERE id = $1`,
        [intent.id, adjustmentType === "refund" ? "refunded" : "reversed"],
      );
    }

    await client.query(
      `UPDATE payment_webhook_events
       SET payment_intent_id = $2, processing_status = 'processed',
           processed_at = NOW()
       WHERE id = $1`,
      [eventId, intent.id],
    );
    return {
      accepted: true,
      idempotentReplay: false,
      status: "processed",
      paymentIntentId: intent.id,
    };
  });
}
