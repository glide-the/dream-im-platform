import { createHash } from "node:crypto";
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
import { monthlyCyclePeriod, monthlyCyclePeriodAt } from "./cycle";
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
    effective_from: Date | null;
  }>(
    `SELECT id, plan_id, status, billing_period, base_price_microusd,
            trial_days, allowance_tokens, allowance_microusd, overage_policy,
            effective_from
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
  if (
    version.billing_period !== "monthly" ||
    safeInteger(version.base_price_microusd, "base_price_microusd") < 0 ||
    safeInteger(version.allowance_microusd, "allowance_microusd") !== 0 ||
    version.overage_policy !== "deny" ||
    version.effective_from !== null ||
    safeInteger(version.allowance_tokens, "allowance_tokens") <= 0
  ) {
    throw new AdminError(
      "SUBSCRIPTION_VERSION_LEGACY_MONETARY",
      "New subscriptions require a published monthly Token-only plan version",
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

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJsonValue(entry)]),
    );
  }
  return value;
}

export function subscriptionRequestDigest(
  operation: string,
  payload: Record<string, unknown>,
) {
  return createHash("sha256")
    .update(JSON.stringify(stableJsonValue({ operation, payload })))
    .digest("hex");
}

async function requireDraftPlanVersion(client: PoolClient, id: string) {
  const result = await client.query<{ status: string }>(
    "SELECT status FROM subscription_plan_versions WHERE id = $1 FOR SHARE",
    [id],
  );
  if (!result.rows[0]) {
    throw new AdminError(
      "SUBSCRIPTION_VERSION_NOT_FOUND",
      "The subscription plan version does not exist",
      409,
    );
  }
  if (result.rows[0].status !== "draft") {
    throw new AdminError(
      "SUBSCRIPTION_ENTITLEMENT_IMMUTABLE",
      "Entitlements can be changed only while their plan version is a draft",
      409,
    );
  }
}

async function insertAllowance(
  client: PoolClient,
  subscriptionId: string,
  planVersionId: string,
  periodNumber: number,
  start: Date,
  end: Date,
  version: Awaited<ReturnType<typeof loadPublishedVersion>>,
) {
  const id = createPlatformId("allow");
  await client.query(
    `INSERT INTO subscription_usage_allowances (
       id, subscription_id, plan_version_id, period_number,
       period_start, period_end, granted_tokens
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      id,
      subscriptionId,
      planVersionId,
      periodNumber,
      start,
      end,
      safeInteger(version.allowance_tokens, "allowance_tokens"),
    ],
  );
  return id;
}

async function insertEvent(
  client: PoolClient,
  input: {
    subscriptionId: string;
    eventType: string;
    idempotencyKey: string;
    actor: { type: "admin" | "product_user" | "system" | "payment_adapter"; id?: string };
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
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10::jsonb)`,
    [
      createPlatformId("subevt"),
      input.subscriptionId,
      input.eventType,
      input.idempotencyKey,
      input.actor.type,
      input.actor.id ?? null,
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
  eventType: string,
  requestDigest: string,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    [idempotencyKey],
  );
  const result = await client.query<{
    subscription_id: string;
    event_type: string;
    metadata: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(
    `SELECT subscription_id, event_type, metadata, after
     FROM subscription_events WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  const existing = result.rows[0];
  if (!existing) return null;
  if (
    existing.event_type !== eventType ||
    existing.metadata?.requestDigest !== requestDigest
  ) {
    throw new AdminError(
      "SUBSCRIPTION_IDEMPOTENCY_CONFLICT",
      "The idempotency key was already used for a different subscription request",
      409,
    );
  }
  return {
    subscriptionId: existing.subscription_id,
    originalAfter: existing.after,
  };
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

export async function activateSubscriptionOnClient(
  client: PoolClient,
  input: {
    platformUserId: string;
    planVersionId: string;
    startsAt?: string;
    startInTrial: boolean;
    idempotencyKey: string;
    reason: string;
    actor: { type: "admin" | "product_user" | "system" | "payment_adapter"; id?: string };
  },
) {
  const requestDigest = subscriptionRequestDigest("activated", {
    platformUserId: input.platformUserId,
    planVersionId: input.planVersionId,
    startsAt: input.startsAt ?? null,
    startInTrial: input.startInTrial,
    reason: input.reason,
  });
  const duplicate = await existingEventSubscription(
    client,
    input.idempotencyKey,
    "activated",
    requestDigest,
  );
  if (duplicate) {
    return {
      id: duplicate.subscriptionId,
      action: "idempotent" as const,
      originalAfter: duplicate.originalAfter,
    };
  }
  const user = await client.query<{ status: string }>(
    `SELECT pu.status
     FROM users AS u
     JOIN platform_users AS pu
       ON pu.source = 'ink-dream'
      AND pu.external_user_id = u.id::text
     WHERE pu.id = $1
     FOR SHARE OF u, pu`,
    [input.platformUserId],
  );
  if (user.rows[0]?.status !== "active") {
    throw new AdminError(
      "SUBSCRIPTION_USER_NOT_ACTIVE",
      "A callable subscription requires an active canonical user",
      409,
    );
  }
  const version = await loadPublishedVersion(client, input.planVersionId);
  if (
    input.actor.type === "product_user" &&
    safeInteger(version.base_price_microusd, "base_price_microusd") > 0
  ) {
    throw new AdminError(
      "SUBSCRIPTION_PAYMENT_REQUIRED",
      "A paid monthly subscription requires a verified payment",
      409,
    );
  }
  const id = createPlatformId("sub");
  const cycleAnchor = input.startsAt ? new Date(input.startsAt) : new Date();
  const periodNumber = 0;
  const { start, end } = monthlyCyclePeriod(cycleAnchor, periodNumber);
  const trialEnd = input.startInTrial && version.trial_days > 0
    ? new Date(start.getTime() + version.trial_days * 86_400_000)
    : null;
  const status = trialEnd ? "trial" : "active";
  await client.query(
    `INSERT INTO subscriptions (
       id, platform_user_id, plan_version_id, status,
       cycle_anchor_at, current_period_number,
       current_period_start, current_period_end, trial_ends_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      id,
      input.platformUserId,
      input.planVersionId,
      status,
      cycleAnchor,
      periodNumber,
      start,
      end,
      trialEnd,
    ],
  );
  const allowanceId = await insertAllowance(
    client,
    id,
    input.planVersionId,
    periodNumber,
    start,
    end,
    version,
  );
  const after = await querySubscriptionItem(client, "subscriptions", id);
  await insertEvent(client, {
    subscriptionId: id,
    eventType: "activated",
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
    reason: input.reason,
    after,
    metadata: { allowanceId, periodNumber, requestDigest },
  });
  return { id, action: "activate" as const, originalAfter: after };
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
      `INSERT INTO subscription_plans (id, code, name, description)
       VALUES ($1, $2, $3, $4)`,
      [id, input.code, input.name, input.description ?? null],
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
         id, plan_id, version_number, trial_days, grace_period_days,
         allowance_tokens, base_price_microusd
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, input.planId, next.rows[0]?.number ?? 1, input.trialDays,
       input.gracePeriodDays, input.allowanceTokens, input.priceMicrousd],
    );
    return { id, action: "create_draft" };
  }
  if (resource === "subscription-entitlements") {
    const input = entitlementCreateSchema.parse(body);
    await requireDraftPlanVersion(client, input.planVersionId);
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
    return await activateSubscriptionOnClient(client, {
      ...input,
      actor: { type: "admin", id: identity.id },
    });
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
             trial_days = COALESCE($2, trial_days),
             grace_period_days = COALESCE($3, grace_period_days),
             allowance_tokens = COALESCE($4, allowance_tokens),
             base_price_microusd = COALESCE($5, base_price_microusd),
             updated_at = NOW() WHERE id = $1`,
          [id, value.trialDays ?? null, value.gracePeriodDays ?? null,
           value.allowanceTokens ?? null, value.priceMicrousd ?? null],
        );
      } else {
        const value = input as z.infer<typeof entitlementUpdateSchema>;
        const entitlement = await client.query<{ plan_version_id: string }>(
          `SELECT plan_version_id FROM subscription_plan_entitlements
           WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!entitlement.rows[0]) {
          throw new AdminError(
            "SUBSCRIPTION_ITEM_NOT_FOUND",
            "The subscription entitlement does not exist",
            404,
          );
        }
        await requireDraftPlanVersion(
          client,
          entitlement.rows[0].plan_version_id,
        );
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
  cycle_anchor_at: Date;
  current_period_number: number;
  current_period_start: Date;
  current_period_end: Date;
  renewal_enabled: boolean;
  version: number;
};

export async function transitionSubscriptionOnClient(
  client: PoolClient,
  input: {
    id: string;
    platformUserId?: string;
    action: string;
    actor: { type: "admin" | "product_user" | "system" | "payment_adapter"; id?: string };
    idempotencyKey: string;
    reason: string;
    expectedVersion: number;
    planVersionId?: string;
  },
) {
  const requestDigest = subscriptionRequestDigest(input.action, {
    subscriptionId: input.id,
    planVersionId: input.planVersionId ?? null,
    reason: input.reason,
    expectedVersion: input.expectedVersion,
  });
  const duplicate = await existingEventSubscription(
    client,
    input.idempotencyKey,
    input.action,
    requestDigest,
  );
  if (duplicate) {
    return {
      subscriptionId: duplicate.subscriptionId,
      idempotent: true,
      originalAfter: duplicate.originalAfter,
    };
  }
  const result = await client.query<SubscriptionRow>(
    `SELECT id, platform_user_id, plan_version_id, pending_plan_version_id,
            status, cycle_anchor_at, current_period_number,
            current_period_start, current_period_end,
            renewal_enabled, version
     FROM subscriptions
     WHERE id = $1
       AND ($2::text IS NULL OR platform_user_id = $2)
     FOR UPDATE`,
    [input.id, input.platformUserId ?? null],
  );
  const before = result.rows[0];
  if (!before) throw new AdminError("SUBSCRIPTION_ITEM_NOT_FOUND", "The subscription does not exist", 404);
  if (before.version !== input.expectedVersion) {
    throw new AdminError(
      "SUBSCRIPTION_VERSION_CONFLICT",
      "The subscription changed after it was loaded; refresh and retry",
      409,
      { expectedVersion: input.expectedVersion, actualVersion: before.version },
    );
  }
  let versionId = before.plan_version_id;
  let status = before.status;
  let pendingVersionId = before.pending_plan_version_id;
  let renewalEnabled = before.renewal_enabled;
  let periodNumber = before.current_period_number;
  let start = before.current_period_start;
  let end = before.current_period_end;
  let allowanceId: string | null = null;
  let periodsSkipped = 0;
  if (input.action === "pause") {
    if (!["trial", "active"].includes(status)) throw new AdminError("SUBSCRIPTION_TRANSITION_INVALID", "Only an active or trial subscription can be paused", 409);
    status = "paused";
    renewalEnabled = false;
  } else if (input.action === "resume") {
    if (status !== "paused") throw new AdminError("SUBSCRIPTION_TRANSITION_INVALID", "Only a paused subscription can resume", 409);
    if (new Date() >= before.current_period_end) {
      throw new AdminError("SUBSCRIPTION_PERIOD_EXPIRED", "An expired paused subscription must be activated again", 409);
    }
    status = "active";
    renewalEnabled = true;
  } else if (input.action === "cancel") {
    if (!["trial", "active"].includes(status)) throw new AdminError("SUBSCRIPTION_TRANSITION_INVALID", "Only an active or trial subscription can schedule cancellation", 409);
    status = "cancel_at_period_end";
    renewalEnabled = false;
  } else if (input.action === "revoke_cancel") {
    if (status !== "cancel_at_period_end") throw new AdminError("SUBSCRIPTION_TRANSITION_INVALID", "Only a period-end cancellation can be revoked", 409);
    if (new Date() >= before.current_period_end) {
      throw new AdminError("SUBSCRIPTION_PERIOD_EXPIRED", "The cancellation can no longer be revoked after the period boundary", 409);
    }
    status = "active";
    renewalEnabled = true;
  } else if (input.action === "upgrade" || input.action === "downgrade") {
    if (!input.planVersionId) throw new AdminError("SUBSCRIPTION_TARGET_REQUIRED", "planVersionId is required", 400);
    if (!["trial", "active"].includes(status)) {
      throw new AdminError(
        "SUBSCRIPTION_TRANSITION_INVALID",
        "Only an active or trial subscription can schedule a plan change",
        409,
      );
    }
    await loadPublishedVersion(client, input.planVersionId);
    pendingVersionId = input.planVersionId;
  } else if (input.action === "renew") {
    if (
      !["trial", "active", "past_due"].includes(
        status,
      )
    ) {
      throw new AdminError(
        "SUBSCRIPTION_TRANSITION_INVALID",
        "Only an active or trial subscription can renew",
        409,
      );
    }
    const now = new Date();
    if (now < before.current_period_end) {
      throw new AdminError(
        "SUBSCRIPTION_PERIOD_NOT_DUE",
        "The subscription can renew only at or after its current period boundary",
        409,
        { periodEnd: before.current_period_end.toISOString() },
      );
    }
    versionId = before.pending_plan_version_id ?? before.plan_version_id;
    const target = await loadPublishedVersion(client, versionId);
    if (
      input.actor.type === "product_user" &&
      safeInteger(target.base_price_microusd, "base_price_microusd") > 0
    ) {
      throw new AdminError(
        "SUBSCRIPTION_PAYMENT_REQUIRED",
        "A paid monthly renewal requires a verified payment",
        409,
      );
    }
    const containingPeriod = monthlyCyclePeriodAt(before.cycle_anchor_at, now);
    periodNumber = Math.max(
      before.current_period_number + 1,
      containingPeriod.periodNumber,
    );
    periodsSkipped = Math.max(
      0,
      periodNumber - before.current_period_number - 1,
    );
    ({ start, end } = monthlyCyclePeriod(before.cycle_anchor_at, periodNumber));
    status = "active";
    renewalEnabled = true;
    pendingVersionId = null;
    allowanceId = await insertAllowance(
      client,
      before.id,
      versionId,
      periodNumber,
      start,
      end,
      target,
    );
  } else {
    throw new AdminError("SUBSCRIPTION_ACTION_NOT_FOUND", "The requested subscription action does not exist", 404);
  }
  const updated = await client.query(
    `UPDATE subscriptions SET plan_version_id = $2,
       pending_plan_version_id = $3, status = $4,
       current_period_start = $5, current_period_end = $6,
       renewal_enabled = $7, current_period_number = $8,
       paused_at = CASE WHEN $4 = 'paused' THEN NOW() ELSE NULL END,
       cancelled_at = CASE WHEN $4 = 'cancelled' THEN NOW() ELSE NULL END,
       version = version + 1, updated_at = NOW()
     WHERE id = $1 AND version = $9`,
    [before.id, versionId, pendingVersionId, status, start, end,
     renewalEnabled, periodNumber, input.expectedVersion],
  );
  if (updated.rowCount !== 1) {
    throw new AdminError(
      "SUBSCRIPTION_VERSION_CONFLICT",
      "The subscription changed concurrently; refresh and retry",
      409,
    );
  }
  const after = await querySubscriptionItem(client, "subscriptions", before.id);
  await insertEvent(client, {
    subscriptionId: before.id,
    eventType: input.action,
    idempotencyKey: input.idempotencyKey,
    actor: input.actor,
    reason: input.reason,
    before: before as unknown as Record<string, unknown>,
    after,
    metadata: { allowanceId, periodNumber, periodsSkipped, requestDigest },
  });
  return { subscriptionId: before.id, idempotent: false, originalAfter: after };
}

export async function advanceSubscriptionPeriodOnClient(
  client: PoolClient,
  input: {
    id: string;
    expectedVersion: number;
    at: Date;
    expectedPeriodEnd: Date;
    idempotencyKey: string;
  },
) {
  const requestDigest = subscriptionRequestDigest("period_boundary", {
    subscriptionId: input.id,
    expectedVersion: input.expectedVersion,
    expectedPeriodEnd: input.expectedPeriodEnd.toISOString(),
  });
  const duplicate = await existingEventSubscription(
    client,
    input.idempotencyKey,
    "period_boundary",
    requestDigest,
  );
  if (duplicate) {
    return {
      subscriptionId: duplicate.subscriptionId,
      outcome: "idempotent" as const,
      originalAfter: duplicate.originalAfter,
    };
  }

  const result = await client.query<SubscriptionRow>(
    `SELECT id, platform_user_id, plan_version_id, pending_plan_version_id,
            status, cycle_anchor_at, current_period_number,
            current_period_start, current_period_end,
            renewal_enabled, version
     FROM subscriptions
     WHERE id = $1
     FOR UPDATE`,
    [input.id],
  );
  const before = result.rows[0];
  if (!before) {
    throw new AdminError(
      "SUBSCRIPTION_ITEM_NOT_FOUND",
      "The subscription does not exist",
      404,
    );
  }
  if (before.version !== input.expectedVersion) {
    throw new AdminError(
      "SUBSCRIPTION_VERSION_CONFLICT",
      "The subscription changed before period advancement",
      409,
      { expectedVersion: input.expectedVersion, actualVersion: before.version },
    );
  }
  if (
    before.current_period_end.getTime() !== input.expectedPeriodEnd.getTime()
  ) {
    throw new AdminError(
      "SUBSCRIPTION_PERIOD_CONFLICT",
      "The subscription period changed before advancement",
      409,
      {
        expectedPeriodEnd: input.expectedPeriodEnd.toISOString(),
        actualPeriodEnd: before.current_period_end.toISOString(),
      },
    );
  }
  if (input.at < before.current_period_end) {
    throw new AdminError(
      "SUBSCRIPTION_PERIOD_NOT_DUE",
      "The subscription period has not reached its boundary",
      409,
      { periodEnd: before.current_period_end.toISOString() },
    );
  }

  let versionId = before.plan_version_id;
  let pendingVersionId = before.pending_plan_version_id;
  let status = before.status;
  let renewalEnabled = before.renewal_enabled;
  let periodNumber = before.current_period_number;
  let start = before.current_period_start;
  let end = before.current_period_end;
  let allowanceId: string | null = null;
  let periodsSkipped = 0;
  let outcome: "renewed" | "payment_required" | "cancelled" | "expired";

  if (status === "cancel_at_period_end") {
    status = "cancelled";
    renewalEnabled = false;
    pendingVersionId = null;
    outcome = "cancelled";
  } else if (
    status === "paused" ||
    status === "past_due" ||
    !renewalEnabled
  ) {
    status = "expired";
    renewalEnabled = false;
    pendingVersionId = null;
    outcome = "expired";
  } else if (status === "active" || status === "trial") {
    versionId = pendingVersionId ?? versionId;
    const target = await loadPublishedVersion(client, versionId);
    if (safeInteger(target.base_price_microusd, "base_price_microusd") > 0) {
      // A priced version may never receive a new monthly Token allowance
      // merely because the scheduler reached the boundary. Keep the expired
      // period bound to the intent and wait for a verified renewal webhook.
      status = "past_due";
      renewalEnabled = true;
      outcome = "payment_required";
    } else {
      const containingPeriod = monthlyCyclePeriodAt(before.cycle_anchor_at, input.at);
      periodNumber = Math.max(
        before.current_period_number + 1,
        containingPeriod.periodNumber,
      );
      periodsSkipped = Math.max(
        0,
        periodNumber - before.current_period_number - 1,
      );
      ({ start, end } = monthlyCyclePeriod(before.cycle_anchor_at, periodNumber));
      status = "active";
      renewalEnabled = true;
      pendingVersionId = null;
      allowanceId = await insertAllowance(
        client,
        before.id,
        versionId,
        periodNumber,
        start,
        end,
        target,
      );
      outcome = "renewed";
    }
  } else {
    throw new AdminError(
      "SUBSCRIPTION_TRANSITION_INVALID",
      "This subscription has no automatic period transition",
      409,
      { status },
    );
  }

  const updated = await client.query(
    `UPDATE subscriptions
     SET plan_version_id = $2,
         pending_plan_version_id = $3,
         status = $4,
         current_period_start = $5,
         current_period_end = $6,
         renewal_enabled = $7,
         current_period_number = $8,
         paused_at = CASE WHEN $4 = 'paused' THEN paused_at ELSE NULL END,
         cancelled_at = CASE WHEN $4 = 'cancelled' THEN $10::timestamptz ELSE NULL END,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $1 AND version = $9`,
    [
      before.id,
      versionId,
      pendingVersionId,
      status,
      start,
      end,
      renewalEnabled,
      periodNumber,
      input.expectedVersion,
      input.at,
    ],
  );
  if (updated.rowCount !== 1) {
    throw new AdminError(
      "SUBSCRIPTION_VERSION_CONFLICT",
      "The subscription changed concurrently during period advancement",
      409,
    );
  }
  const after = await querySubscriptionItem(client, "subscriptions", before.id);
  await insertEvent(client, {
    subscriptionId: before.id,
    eventType: "period_boundary",
    idempotencyKey: input.idempotencyKey,
    actor: { type: "system", id: "subscription-period-worker" },
    reason: `Automatic monthly period ${outcome}`,
    before: before as unknown as Record<string, unknown>,
    after,
    metadata: {
      outcome,
      allowanceId,
      periodNumber,
      periodsSkipped,
      requestDigest,
    },
  });
  return {
    subscriptionId: before.id,
    outcome,
    originalAfter: after,
  };
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
      await parseBody(request, publishVersionSchema);
      const data = await withPlatformTransaction(async (client) => {
        const before = await querySubscriptionItem(client, resource, id);
        if (before.status === "published") return before;
        const count = await client.query<{ count: string }>(
          "SELECT COUNT(*)::text AS count FROM subscription_plan_entitlements WHERE plan_version_id = $1 AND enabled",
          [id],
        );
        if (count.rows[0]?.count === "0") throw new AdminError("SUBSCRIPTION_ENTITLEMENT_REQUIRED", "Publish requires at least one enabled model entitlement", 409);
        const version = await client.query<{
          allowance_tokens: string | number;
          billing_period: string;
          base_price_microusd: string | number;
          allowance_microusd: string | number;
          overage_policy: string;
          effective_from: Date | null;
        }>(
          `SELECT allowance_tokens, billing_period, base_price_microusd,
                  allowance_microusd, overage_policy, effective_from
           FROM subscription_plan_versions WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const draft = version.rows[0];
        if (
          !draft ||
          safeInteger(draft.allowance_tokens, "allowance_tokens") <= 0 ||
          draft.billing_period !== "monthly" ||
          safeInteger(draft.base_price_microusd, "base_price_microusd") < 0 ||
          safeInteger(draft.allowance_microusd, "allowance_microusd") !== 0 ||
          draft.overage_policy !== "deny" ||
          draft.effective_from !== null
        ) {
          throw new AdminError(
            "SUBSCRIPTION_VERSION_NOT_TOKEN_ONLY",
            "Publish requires a monthly Token-only version with an integer micro-USD price and no monetary allowance",
            409,
          );
        }
        await client.query(
          `UPDATE subscription_plan_versions SET status = 'published',
             published_at = NOW(), updated_at = NOW() WHERE id = $1 AND status = 'draft'`,
          [id],
        );
        await client.query("UPDATE subscription_plans SET status = 'active', updated_at = NOW() WHERE id = $1", [before.plan_id]);
        const after = await querySubscriptionItem(client, resource, id);
        await audit(client, request, requestId, identity, "publish", resource, id, before, after);
        return after;
      });
      return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
    }
    if (resource !== "subscriptions") throw new AdminError("SUBSCRIPTION_ACTION_NOT_FOUND", "The requested subscription action does not exist", 404);
    if (!["renew", "upgrade", "downgrade", "pause", "resume", "cancel", "revoke_cancel"].includes(action)) throw new AdminError("SUBSCRIPTION_ACTION_NOT_FOUND", "The requested subscription action does not exist", 404);
    const input = await parseBody(request, subscriptionActionSchema);
    const data = await withPlatformTransaction(async (client) => {
      const transition = await transitionSubscriptionOnClient(client, {
        id, action, actor: { type: "admin", id: identity.id },
        idempotencyKey: input.idempotencyKey,
        reason: input.reason, expectedVersion: input.expectedVersion,
        planVersionId: input.planVersionId,
      });
      const after = transition.idempotent && transition.originalAfter
        ? transition.originalAfter
        : await querySubscriptionItem(
            client,
            "subscriptions",
            transition.subscriptionId,
          );
      if (!transition.idempotent) {
        await audit(
          client,
          request,
          requestId,
          identity,
          action,
          resource,
          transition.subscriptionId,
          {},
          after,
        );
      }
      return after;
    });
    return Response.json({ data }, { headers: { "cache-control": "no-store", "x-request-id": requestId } });
  } catch (error) {
    return adminErrorResponse(subscriptionError(error), requestId);
  }
}

export { isSubscriptionResource };
