import type { PoolClient } from "pg";
import { z } from "zod";
import { recordAdminAuditOnClient } from "../admin/audit";
import { AdminError, adminErrorResponse } from "../admin/errors";
import {
  adminRequestId,
  assertAdminMutationOrigin,
  requireAdminRequest,
} from "../admin/guard";
import type { AdminIdentity } from "../admin/session";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import {
  entitlementCreateSchema,
  entitlementUpdateSchema,
  isSubscriptionResource,
  planCreateSchema,
  planUpdateSchema,
  planVersionCreateSchema,
  planVersionUpdateSchema,
  publishVersionSchema,
  subscriptionActionSchema,
  subscriptionCreateSchema,
  type SubscriptionResource,
} from "./contracts";
import { querySubscriptionItem, querySubscriptionList } from "./repository";

async function parseBody<T extends z.ZodTypeAny>(request: Request, schema: T) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new AdminError(
      "SUBSCRIPTION_JSON_INVALID",
      "The request body must contain valid JSON",
      400,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new AdminError(
      "SUBSCRIPTION_INPUT_INVALID",
      "The subscription input is invalid",
      400,
      parsed.error.issues.slice(0, 8),
    );
  }
  return parsed.data;
}

function subscriptionError(error: unknown) {
  if (error instanceof AdminError) return error;
  if (error instanceof z.ZodError) {
    return new AdminError(
      "SUBSCRIPTION_INPUT_INVALID",
      "The subscription input is invalid",
      400,
      error.issues.slice(0, 8),
    );
  }
  const pg = error as { code?: string; constraint?: string };
  if (pg.code === "23505") {
    return new AdminError(
      "SUBSCRIPTION_CONFLICT",
      "The operation conflicts with an existing plan, version, entitlement, subscription, or idempotency key",
      409,
      { constraint: pg.constraint },
    );
  }
  if (pg.code === "23503") {
    return new AdminError(
      "SUBSCRIPTION_RELATION_CONFLICT",
      "A referenced user, model, plan, or version does not exist",
      409,
      { constraint: pg.constraint },
    );
  }
  if (pg.code === "23514") {
    return new AdminError(
      "SUBSCRIPTION_STATE_CONFLICT",
      "The operation violates an immutable snapshot or lifecycle rule",
      409,
      { constraint: pg.constraint },
    );
  }
  return error;
}

function nextPeriod(start: Date, period: "monthly" | "annual") {
  const result = new Date(start);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  if (period === "monthly") result.setUTCMonth(result.getUTCMonth() + 1);
  else result.setUTCFullYear(result.getUTCFullYear() + 1);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

async function loadPublishedVersion(client: PoolClient, id: string) {
  const result = await client.query<{
    id: string;
    plan_id: string;
    status: string;
    billing_period: "monthly" | "annual";
    base_price_microusd: string | number;
    trial_days: number;
    allowance_tokens: string | number;
    allowance_microusd: string | number;
    overage_policy: "deny" | "cash_balance";
  }>(
    `SELECT id, plan_id, status, billing_period, base_price_microusd,
            trial_days, allowance_tokens, allowance_microusd, overage_policy
     FROM subscription_plan_versions WHERE id = $1 FOR SHARE`,
    [id],
  );
  const version = result.rows[0];
  if (!version || version.status !== "published") {
    throw new AdminError(
      "SUBSCRIPTION_VERSION_NOT_CALLABLE",
      "A subscription requires a published plan version",
      409,
    );
  }
  return version;
}

function safeInteger(value: string | number, field: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new AdminError(
      "SUBSCRIPTION_AMOUNT_INVALID",
      `${field} is outside the supported integer range`,
      500,
    );
  }
  return parsed;
}

async function insertAllowance(
  client: PoolClient,
  subscriptionId: string,
  start: Date,
  end: Date,
  version: Awaited<ReturnType<typeof loadPublishedVersion>>,
) {
  const id = createPlatformId("allow");
  await client.query(
    `INSERT INTO subscription_usage_allowances (
       id, subscription_id, period_start, period_end,
       granted_tokens, granted_microusd
     ) VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      id,
      subscriptionId,
      start,
      end,
      safeInteger(version.allowance_tokens, "allowance_tokens"),
      safeInteger(version.allowance_microusd, "allowance_microusd"),
    ],
  );
  return id;
}

async function chargeBasePrice(
  client: PoolClient,
  input: {
    subscriptionId: string;
    platformUserId: string;
    amountMicrousd: number;
    idempotencyKey: string;
    identity: AdminIdentity;
    description: string;
  },
) {
  if (input.amountMicrousd === 0) return null;
  const account = await client.query<{
    id: string;
    available_microusd: string | number;
    reserved_microusd: string | number;
    lifetime_debited_microusd: string | number;
  }>(
    `SELECT id, available_microusd, reserved_microusd,
            lifetime_debited_microusd
     FROM billing_accounts WHERE platform_user_id = $1 FOR UPDATE`,
    [input.platformUserId],
  );
  if (!account.rows[0]) {
    throw new AdminError(
      "SUBSCRIPTION_BILLING_ACCOUNT_MISSING",
      "The user does not have a billing account",
      409,
    );
  }
  const row = account.rows[0];
  const available = safeInteger(row.available_microusd, "available_microusd");
  const reserved = safeInteger(row.reserved_microusd, "reserved_microusd");
  const lifetime = safeInteger(
    row.lifetime_debited_microusd,
    "lifetime_debited_microusd",
  );
  if (available < input.amountMicrousd) {
    throw new AdminError(
      "SUBSCRIPTION_BALANCE_INSUFFICIENT",
      "The billing account balance is insufficient for the subscription charge",
      402,
      { availableMicrousd: available, requiredMicrousd: input.amountMicrousd },
    );
  }
  const after = available - input.amountMicrousd;
  await client.query(
    `UPDATE billing_accounts
     SET available_microusd = $2, lifetime_debited_microusd = $3,
         version = version + 1, updated_at = NOW()
     WHERE id = $1`,
    [row.id, after, lifetime + input.amountMicrousd],
  );
  const ledgerId = createPlatformId("ledger");
  await client.query(
    `INSERT INTO billing_ledger_entries (
       id, account_id, platform_user_id, subscription_id, entry_type,
       amount_microusd, available_before_microusd,
       available_after_microusd, reserved_before_microusd,
       reserved_after_microusd, idempotency_key, description,
       actor_type, actor_id, metadata
     ) VALUES ($1, $2, $3, $4, 'subscription_charge', $5, $6, $7,
               $8, $8, $9, $10, 'admin', $11, '{}'::jsonb)`,
    [
      ledgerId,
      row.id,
      input.platformUserId,
      input.subscriptionId,
      input.amountMicrousd,
      available,
      after,
      reserved,
      `${input.idempotencyKey}:charge`,
      input.description,
      input.identity.id,
    ],
  );
  return ledgerId;
}

async function insertEvent(
  client: PoolClient,
  input: {
    subscriptionId: string;
    eventType: string;
    idempotencyKey: string;
    identity: AdminIdentity;
    reason: string;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO subscription_events (
       id, subscription_id, event_type, idempotency_key, actor_type,
       actor_id, reason, before, after, metadata
     ) VALUES ($1, $2, $3, $4, 'admin', $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)`,
    [
      createPlatformId("subevt"),
      input.subscriptionId,
      input.eventType,
      input.idempotencyKey,
      input.identity.id,
      input.reason,
      input.before ? JSON.stringify(input.before) : null,
      input.after ? JSON.stringify(input.after) : null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function existingEventSubscription(
  client: PoolClient,
  idempotencyKey: string,
) {
  const result = await client.query<{ subscription_id: string }>(
    "SELECT subscription_id FROM subscription_events WHERE idempotency_key = $1",
    [idempotencyKey],
  );
  return result.rows[0]?.subscription_id ?? null;
}

async function audit(
  client: PoolClient,
  request: Request,
  requestId: string,
  identity: AdminIdentity,
  action: string,
  resource: string,
  resourceId: string,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
) {
  await recordAdminAuditOnClient(client, {
    identity,
    action,
    resourceType: resource,
    resourceId,
    requestId,
    request,
    before,
    after,
    metadata: { domain: "subscriptions" },
  });
}

export async function handleSubscriptionList(
  request: Request,
  resource: SubscriptionResource,
) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "subscriptions.read");
    const response = await withPlatformClient(
      async (client) => await querySubscriptionList(client, request, resource),
    );
    return Response.json(response, {
      headers: { "cache-control": "no-store", "x-request-id": requestId },
    });
  } catch (error) {
    return adminErrorResponse(subscriptionError(error), requestId);
  }
}

export async function handleSubscriptionGetOne(
  request: Request,
  resource: SubscriptionResource,
  id: string,
) {
  const requestId = adminRequestId(request);
  try {
    await requireAdminRequest(request, "subscriptions.read");
    const data = await withPlatformClient(
      async (client) => await querySubscriptionItem(client, resource, id),
    );
    return Response.json(
      { data },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch (error) {
    return adminErrorResponse(subscriptionError(error), requestId);
  }
}

async function createResource(
  client: PoolClient,
  resource: SubscriptionResource,
  body: unknown,
  identity: AdminIdentity,
) {
  if (resource === "subscription-plans") {
    const input = planCreateSchema.parse(body);
    const id = createPlatformId("plan");
    await client.query(
      `INSERT INTO subscription_plans (id, code, name, description, currency)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, input.code, input.name, input.description ?? null, input.currency],
    );
    return { id, action: "create" };
  }
  if (resource === "subscription-plan-versions") {
    const input = planVersionCreateSchema.parse(body);
    await client.query("SELECT id FROM subscription_plans WHERE id = $1 FOR UPDATE", [input.planId]);
    const next = await client.query<{ number: number }>(
      "SELECT COALESCE(MAX(version_number), 0)::int + 1 AS number FROM subscription_plan_versions WHERE plan_id = $1",
      [input.planId],
    );
    const id = createPlatformId("planv");
    await client.query(
      `INSERT INTO subscription_plan_versions (
         id, plan_id, version_number, billing_period, base_price_microusd,
         trial_days, grace_period_days, allowance_tokens,
         allowance_microusd, overage_policy, effective_from
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [id, input.planId, next.rows[0]?.number ?? 1, input.billingPeriod,
       input.basePriceMicrousd, input.trialDays, input.gracePeriodDays,
       input.allowanceTokens, input.allowanceMicrousd, input.overagePolicy,
       input.effectiveFrom ?? null],
    );
    return { id, action: "create_draft" };
  }
  if (resource === "subscription-entitlements") {
    const input = entitlementCreateSchema.parse(body);
    const id = createPlatformId("ent");
    await client.query(
      `INSERT INTO subscription_plan_entitlements (
         id, plan_version_id, model_id, gateway_scopes,
         requests_per_minute, daily_token_limit, monthly_token_limit,
         storage_bytes_limit, enabled
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, input.planVersionId, input.modelId, input.gatewayScopes,
       input.requestsPerMinute ?? null, input.dailyTokenLimit ?? null,
       input.monthlyTokenLimit ?? null, input.storageBytesLimit ?? null,
       input.enabled],
    );
    return { id, action: "create" };
  }
  if (resource === "subscriptions") {
    const input = subscriptionCreateSchema.parse(body);
    const duplicate = await existingEventSubscription(client, input.idempotencyKey);
    if (duplicate) return { id: duplicate, action: "idempotent" };
    const user = await client.query<{ status: string }>(
      "SELECT status FROM platform_users WHERE id = $1 FOR SHARE",
      [input.platformUserId],
    );
    if (user.rows[0]?.status !== "active") {
      throw new AdminError("SUBSCRIPTION_USER_NOT_ACTIVE", "A callable subscription requires an active billing identity", 409);
    }
    const version = await loadPublishedVersion(client, input.planVersionId);
    const id = createPlatformId("sub");
    const start = input.startsAt ? new Date(input.startsAt) : new Date();
    const end = nextPeriod(start, version.billing_period);
    const trialEnd = input.startInTrial && version.trial_days > 0
      ? new Date(start.getTime() + version.trial_days * 86_400_000)
      : null;
    const status = trialEnd ? "trial" : "active";
    await client.query(
      `INSERT INTO subscriptions (
         id, platform_user_id, plan_version_id, status,
         current_period_start, current_period_end, trial_ends_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, input.platformUserId, input.planVersionId, status, start, end, trialEnd],
    );
    const allowanceId = await insertAllowance(client, id, start, end, version);
    if (!trialEnd) {
      await chargeBasePrice(client, {
        subscriptionId: id,
        platformUserId: input.platformUserId,
        amountMicrousd: safeInteger(version.base_price_microusd, "base_price_microusd"),
        idempotencyKey: input.idempotencyKey,
        identity,
        description: "Subscription activation charge",
      });
    }
    await insertEvent(client, {
      subscriptionId: id,
      eventType: "activated",
      idempotencyKey: input.idempotencyKey,
      identity,
      reason: input.reason,
      after: { status, planVersionId: input.planVersionId, periodStart: start.toISOString(), periodEnd: end.toISOString() },
      metadata: { allowanceId },
    });
    return { id, action: "activate" };
  }
  throw new AdminError(
    "SUBSCRIPTION_CREATE_DENIED",
    "Allowances and subscription events are system-managed and append-only",
    405,
  );
}

export async function handleSubscriptionCreate(
  request: Request,
  resource: SubscriptionResource,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "subscriptions.write");
    let body: unknown;
    try { body = await request.json(); } catch { throw new AdminError("SUBSCRIPTION_JSON_INVALID", "The request body must contain valid JSON", 400); }
    const result = await withPlatformTransaction(async (client) => {
      const created = await createResource(client, resource, body, identity);
      const data = await querySubscriptionItem(client, resource, created.id);
      if (created.action !== "idempotent") {
        await audit(client, request, requestId, identity, created.action, resource, created.id, {}, data);
      }
      return data;
    });
    return Response.json({ data: result }, { status: 201, headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(subscriptionError(error), requestId);
  }
}

export async function handleSubscriptionUpdate(
  request: Request,
  resource: SubscriptionResource,
  id: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "subscriptions.write");
    const schema = resource === "subscription-plans" ? planUpdateSchema
      : resource === "subscription-plan-versions" ? planVersionUpdateSchema
      : resource === "subscription-entitlements" ? entitlementUpdateSchema
      : null;
    if (!schema) throw new AdminError("SUBSCRIPTION_UPDATE_DENIED", "Subscription lifecycle changes require an explicit action", 405);
    const input = await parseBody(request, schema);
    const data = await withPlatformTransaction(async (client) => {
      const before = await querySubscriptionItem(client, resource, id);
      if (resource === "subscription-plans") {
        const value = input as z.infer<typeof planUpdateSchema>;
        await client.query(
          `UPDATE subscription_plans SET
             name = COALESCE($2, name),
             description = CASE WHEN $3::boolean THEN $4 ELSE description END,
             status = COALESCE($5, status), updated_at = NOW()
           WHERE id = $1`,
          [id, value.name ?? null, value.description !== undefined, value.description ?? null, value.status ?? null],
        );
      } else if (resource === "subscription-plan-versions") {
        const value = input as z.infer<typeof planVersionUpdateSchema>;
        const current = await client.query<{ status: string }>("SELECT status FROM subscription_plan_versions WHERE id = $1 FOR UPDATE", [id]);
        if (current.rows[0]?.status !== "draft") throw new AdminError("SUBSCRIPTION_VERSION_IMMUTABLE", "Only draft plan versions can be edited", 409);
        await client.query(
          `UPDATE subscription_plan_versions SET
             billing_period = COALESCE($2, billing_period),
             base_price_microusd = COALESCE($3, base_price_microusd),
             trial_days = COALESCE($4, trial_days),
             grace_period_days = COALESCE($5, grace_period_days),
             allowance_tokens = COALESCE($6, allowance_tokens),
             allowance_microusd = COALESCE($7, allowance_microusd),
             overage_policy = COALESCE($8, overage_policy),
             effective_from = CASE WHEN $9::boolean THEN $10::timestamptz ELSE effective_from END,
             updated_at = NOW() WHERE id = $1`,
          [id, value.billingPeriod ?? null, value.basePriceMicrousd ?? null,
           value.trialDays ?? null, value.gracePeriodDays ?? null,
           value.allowanceTokens ?? null, value.allowanceMicrousd ?? null,
           value.overagePolicy ?? null, value.effectiveFrom !== undefined,
           value.effectiveFrom ?? null],
        );
      } else {
        const value = input as z.infer<typeof entitlementUpdateSchema>;
        await client.query(
          `UPDATE subscription_plan_entitlements SET
             gateway_scopes = COALESCE($2, gateway_scopes),
             requests_per_minute = CASE WHEN $3::boolean THEN $4 ELSE requests_per_minute END,
             daily_token_limit = CASE WHEN $5::boolean THEN $6 ELSE daily_token_limit END,
             monthly_token_limit = CASE WHEN $7::boolean THEN $8 ELSE monthly_token_limit END,
             storage_bytes_limit = CASE WHEN $9::boolean THEN $10 ELSE storage_bytes_limit END,
             enabled = COALESCE($11, enabled), updated_at = NOW()
           WHERE id = $1`,
          [id, value.gatewayScopes ?? null,
           value.requestsPerMinute !== undefined, value.requestsPerMinute ?? null,
           value.dailyTokenLimit !== undefined, value.dailyTokenLimit ?? null,
           value.monthlyTokenLimit !== undefined, value.monthlyTokenLimit ?? null,
           value.storageBytesLimit !== undefined, value.storageBytesLimit ?? null,
           value.enabled ?? null],
        );
      }
      const after = await querySubscriptionItem(client, resource, id);
      await audit(client, request, requestId, identity, "update", resource, id, before, after);
      return after;
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(subscriptionError(error), requestId);
  }
}

export async function handleSubscriptionDelete(
  request: Request,
  resource: SubscriptionResource,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    await requireAdminRequest(request, "subscriptions.write");
    throw new AdminError("SUBSCRIPTION_DELETE_DENIED", `${resource} records cannot be hard-deleted`, 405);
  } catch (error) {
    return adminErrorResponse(subscriptionError(error), requestId);
  }
}

type SubscriptionRow = {
  id: string;
  platform_user_id: string;
  plan_version_id: string;
  pending_plan_version_id: string | null;
  status: string;
  current_period_start: Date;
  current_period_end: Date;
  renewal_enabled: boolean;
  version: number;
};

async function transitionSubscription(
  client: PoolClient,
  input: {
    id: string;
    action: string;
    identity: AdminIdentity;
    idempotencyKey: string;
    reason: string;
    planVersionId?: string;
  },
) {
  const duplicate = await existingEventSubscription(client, input.idempotencyKey);
  if (duplicate) return duplicate;
  const result = await client.query<SubscriptionRow>(
    `SELECT id, platform_user_id, plan_version_id, pending_plan_version_id,
            status, current_period_start, current_period_end,
            renewal_enabled, version
     FROM subscriptions WHERE id = $1 FOR UPDATE`,
    [input.id],
  );
  const before = result.rows[0];
  if (!before) throw new AdminError("SUBSCRIPTION_ITEM_NOT_FOUND", "The subscription does not exist", 404);
  let versionId = before.plan_version_id;
  let status = before.status;
  let pendingVersionId = before.pending_plan_version_id;
  let renewalEnabled = before.renewal_enabled;
  let start = before.current_period_start;
  let end = before.current_period_end;
  let allowanceId: string | null = null;
  if (input.action === "pause") {
    if (!["trial", "active", "past_due", "cancel_at_period_end"].includes(status)) throw new AdminError("SUBSCRIPTION_TRANSITION_INVALID", "Only a callable subscription can be paused", 409);
    status = "paused";
    renewalEnabled = false;
  } else if (input.action === "resume") {
    if (!["paused", "past_due"].includes(status)) throw new AdminError("SUBSCRIPTION_TRANSITION_INVALID", "Only paused or past-due subscriptions can resume", 409);
    status = "active";
    renewalEnabled = true;
  } else if (input.action === "cancel") {
    if (!["trial", "active", "past_due", "paused"].includes(status)) throw new AdminError("SUBSCRIPTION_TRANSITION_INVALID", "This subscription cannot be cancelled", 409);
    status = "cancel_at_period_end";
    renewalEnabled = false;
  } else if (input.action === "downgrade") {
    if (!input.planVersionId) throw new AdminError("SUBSCRIPTION_TARGET_REQUIRED", "planVersionId is required", 400);
    await loadPublishedVersion(client, input.planVersionId);
    pendingVersionId = input.planVersionId;
  } else if (input.action === "upgrade" || input.action === "renew") {
    if (
      !["trial", "active", "past_due", "cancel_at_period_end"].includes(
        status,
      )
    ) {
      throw new AdminError(
        "SUBSCRIPTION_TRANSITION_INVALID",
        "Only a trial, active, past-due, or period-end-cancelling subscription can renew or upgrade",
        409,
      );
    }
    if (input.action === "upgrade" && !input.planVersionId) throw new AdminError("SUBSCRIPTION_TARGET_REQUIRED", "planVersionId is required", 400);
    versionId = input.action === "upgrade"
      ? input.planVersionId!
      : before.pending_plan_version_id ?? before.plan_version_id;
    const target = await loadPublishedVersion(client, versionId);
    start = input.action === "renew" && before.current_period_end > new Date()
      ? before.current_period_end
      : new Date();
    end = nextPeriod(start, target.billing_period);
    status = "active";
    renewalEnabled = true;
    pendingVersionId = null;
    await chargeBasePrice(client, {
      subscriptionId: before.id,
      platformUserId: before.platform_user_id,
      amountMicrousd: safeInteger(target.base_price_microusd, "base_price_microusd"),
      idempotencyKey: input.idempotencyKey,
      identity: input.identity,
      description: input.action === "upgrade" ? "Subscription upgrade charge" : "Subscription renewal charge",
    });
    allowanceId = await insertAllowance(client, before.id, start, end, target);
  } else {
    throw new AdminError("SUBSCRIPTION_ACTION_NOT_FOUND", "The requested subscription action does not exist", 404);
  }
  await client.query(
    `UPDATE subscriptions SET plan_version_id = $2,
       pending_plan_version_id = $3, status = $4,
       current_period_start = $5, current_period_end = $6,
       renewal_enabled = $7,
       paused_at = CASE WHEN $4 = 'paused' THEN NOW() ELSE NULL END,
       cancelled_at = CASE WHEN $4 = 'cancel_at_period_end' THEN NOW() ELSE NULL END,
       version = version + 1, updated_at = NOW()
     WHERE id = $1`,
    [before.id, versionId, pendingVersionId, status, start, end, renewalEnabled],
  );
  const after = await querySubscriptionItem(client, "subscriptions", before.id);
  await insertEvent(client, {
    subscriptionId: before.id,
    eventType: input.action,
    idempotencyKey: input.idempotencyKey,
    identity: input.identity,
    reason: input.reason,
    before: before as unknown as Record<string, unknown>,
    after,
    metadata: { allowanceId },
  });
  return before.id;
}

export async function handleSubscriptionAction(
  request: Request,
  resource: string,
  id: string,
  action: string,
) {
  const requestId = adminRequestId(request);
  try {
    assertAdminMutationOrigin(request);
    const identity = await requireAdminRequest(request, "subscriptions.write");
    if (resource === "subscription-plan-versions" && action === "publish") {
      const input = await parseBody(request, publishVersionSchema);
      const data = await withPlatformTransaction(async (client) => {
        const before = await querySubscriptionItem(client, resource, id);
        if (before.status === "published") return before;
        const count = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM subscription_plan_entitlements WHERE plan_version_id = $1 AND enabled",
          [id],
        );
        if (count.rows[0]?.count === "0") throw new AdminError("SUBSCRIPTION_ENTITLEMENT_REQUIRED", "Publish requires at least one enabled model entitlement", 409);
        await client.query(
          `UPDATE subscription_plan_versions SET status = 'published',
             effective_from = COALESCE($2::timestamptz, effective_from, NOW()),
             published_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'draft'`,
          [id, input.effectiveFrom ?? null],
        );
        await client.query("UPDATE subscription_plans SET status = 'active', updated_at = NOW() WHERE id = $1", [before.plan_id]);
        const after = await querySubscriptionItem(client, resource, id);
        await audit(client, request, requestId, identity, "publish", resource, id, before, after);
        return after;
      });
      return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
    }
    if (resource !== "subscriptions") throw new AdminError("SUBSCRIPTION_ACTION_NOT_FOUND", "The requested subscription action does not exist", 404);
    if (!["renew", "upgrade", "downgrade", "pause", "resume", "cancel"].includes(action)) throw new AdminError("SUBSCRIPTION_ACTION_NOT_FOUND", "The requested subscription action does not exist", 404);
    const input = await parseBody(request, subscriptionActionSchema);
    const data = await withPlatformTransaction(async (client) => {
      const subscriptionId = await transitionSubscription(client, {
        id, action, identity, idempotencyKey: input.idempotencyKey,
        reason: input.reason, planVersionId: input.planVersionId,
      });
      const after = await querySubscriptionItem(client, "subscriptions", subscriptionId);
      await audit(client, request, requestId, identity, action, resource, subscriptionId, {}, after);
      return after;
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(subscriptionError(error), requestId);
  }
}

export { isSubscriptionResource };
