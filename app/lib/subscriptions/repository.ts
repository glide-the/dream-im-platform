import type { PoolClient } from "pg";
import { AdminError } from "../admin/errors";
import {
  adminListResponse,
  buildAdminListClauses,
  parseAdminListQuery,
} from "../admin/list-query";
import type { SubscriptionResource } from "./contracts";

type Config = {
  select: string;
  from: string;
  columns: Record<string, string>;
  filterFields: string[];
  defaultSort: string;
};

const configs: Record<SubscriptionResource, Config> = {
  "subscription-plans": {
    select: `p.id, p.code, p.name, p.description, p.status,
             p.created_at, p.updated_at,
             (SELECT COUNT(*)::int FROM subscription_plan_versions v WHERE v.plan_id = p.id) AS version_count`,
    from: "FROM subscription_plans p",
    columns: { id: "p.id", code: "p.code", name: "p.name", status: "p.status", created_at: "p.created_at", updated_at: "p.updated_at" },
    filterFields: ["code", "name", "status"],
    defaultSort: "updated_at",
  },
  "subscription-plan-versions": {
    select: `v.id, v.plan_id, p.code AS plan_code, p.name AS plan_name,
             v.version_number, v.status, 'monthly'::text AS billing_period,
             v.trial_days, v.grace_period_days, v.allowance_tokens,
             v.published_at, v.created_at, v.updated_at,
             (SELECT COUNT(*)::int FROM subscription_plan_entitlements e WHERE e.plan_version_id = v.id AND e.enabled) AS entitlement_count`,
    from: "FROM subscription_plan_versions v JOIN subscription_plans p ON p.id = v.plan_id",
    columns: { id: "v.id", plan_id: "v.plan_id", plan_code: "p.code", version_number: "v.version_number", status: "v.status", billing_period: "v.billing_period", created_at: "v.created_at", updated_at: "v.updated_at" },
    filterFields: ["plan_id", "plan_code", "status"],
    defaultSort: "created_at",
  },
  "subscription-entitlements": {
    select: `e.id, e.plan_version_id, p.code AS plan_code, v.version_number,
             e.model_id, m.code AS model_code, m.display_name AS model_name,
             e.gateway_scopes, e.requests_per_minute, e.daily_token_limit,
             e.monthly_token_limit, e.storage_bytes_limit, e.enabled,
             e.created_at, e.updated_at`,
    from: `FROM subscription_plan_entitlements e
           JOIN subscription_plan_versions v ON v.id = e.plan_version_id
           JOIN subscription_plans p ON p.id = v.plan_id
           JOIN ai_models m ON m.id = e.model_id`,
    columns: { id: "e.id", plan_version_id: "e.plan_version_id", plan_code: "p.code", model_id: "e.model_id", model_code: "m.code", enabled: "e.enabled::text", created_at: "e.created_at", updated_at: "e.updated_at" },
    filterFields: ["plan_version_id", "plan_code", "model_id", "model_code", "enabled"],
    defaultSort: "created_at",
  },
  subscriptions: {
    select: `s.id, s.platform_user_id, u.email, u.display_name,
             s.plan_version_id, p.code AS plan_code, p.name AS plan_name,
             v.version_number, s.pending_plan_version_id,
             pending_p.code AS pending_plan_code,
             pending_v.version_number AS pending_version_number, s.status,
             s.cycle_anchor_at, s.current_period_number,
             s.current_period_start, s.current_period_end, s.trial_ends_at,
             s.grace_ends_at, s.renewal_enabled, s.paused_at, s.cancelled_at,
             s.version, s.created_at, s.updated_at,
             a.id AS allowance_id, a.granted_tokens, a.reserved_tokens,
             a.consumed_tokens`,
    from: `FROM subscriptions s
           JOIN platform_users u ON u.id = s.platform_user_id
           JOIN subscription_plan_versions v ON v.id = s.plan_version_id
           JOIN subscription_plans p ON p.id = v.plan_id
           LEFT JOIN subscription_plan_versions pending_v
             ON pending_v.id = s.pending_plan_version_id
           LEFT JOIN subscription_plans pending_p
             ON pending_p.id = pending_v.plan_id
           LEFT JOIN subscription_usage_allowances a ON a.subscription_id = s.id
             AND a.period_start = s.current_period_start AND a.period_end = s.current_period_end`,
    columns: { id: "s.id", platform_user_id: "s.platform_user_id", email: "u.email", plan_version_id: "s.plan_version_id", plan_code: "p.code", status: "s.status", current_period_end: "s.current_period_end", created_at: "s.created_at", updated_at: "s.updated_at" },
    filterFields: ["platform_user_id", "email", "plan_version_id", "plan_code", "status"],
    defaultSort: "updated_at",
  },
  "subscription-allowances": {
    select: `a.id, a.subscription_id, s.platform_user_id, u.email,
             a.plan_version_id, a.period_number, a.period_start, a.period_end,
             a.granted_tokens, a.reserved_tokens, a.consumed_tokens,
             a.version, a.created_at, a.updated_at`,
    from: `FROM subscription_usage_allowances a
           JOIN subscriptions s ON s.id = a.subscription_id
           JOIN platform_users u ON u.id = s.platform_user_id`,
    columns: { id: "a.id", subscription_id: "a.subscription_id", platform_user_id: "s.platform_user_id", email: "u.email", period_start: "a.period_start", period_end: "a.period_end", created_at: "a.created_at", updated_at: "a.updated_at" },
    filterFields: ["subscription_id", "platform_user_id", "email"],
    defaultSort: "period_start",
  },
  "subscription-events": {
    select: `e.id, e.subscription_id, e.event_type, e.idempotency_key,
             e.actor_type, e.actor_id, e.reason, e.before, e.after,
             e.metadata, e.created_at`,
    from: "FROM subscription_events e",
    columns: { id: "e.id", subscription_id: "e.subscription_id", event_type: "e.event_type", actor_type: "e.actor_type", created_at: "e.created_at" },
    filterFields: ["subscription_id", "event_type", "actor_type"],
    defaultSort: "created_at",
  },
};

export async function querySubscriptionList(
  client: PoolClient,
  request: Request,
  resource: SubscriptionResource,
) {
  const config = configs[resource];
  const query = parseAdminListQuery(request, {
    sortFields: Object.keys(config.columns),
    filterFields: config.filterFields,
    defaultSort: config.defaultSort,
  });
  const clauses = buildAdminListClauses(query, { columns: config.columns });
  const data = await client.query<Record<string, unknown>>(
    `SELECT ${config.select} ${config.from}
     ${clauses.whereSql} ${clauses.orderSql} ${clauses.pageSql}`,
    clauses.parameters,
  );
  const count = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total ${config.from} ${clauses.whereSql}`,
    clauses.parameters.slice(0, -2),
  );
  return adminListResponse(data.rows, query, Number(count.rows[0]?.total ?? 0));
}

export async function querySubscriptionItem(
  client: PoolClient,
  resource: SubscriptionResource,
  id: string,
) {
  const config = configs[resource];
  const result = await client.query<Record<string, unknown>>(
    `SELECT ${config.select} ${config.from} WHERE ${config.columns.id} = $1 LIMIT 1`,
    [id],
  );
  if (!result.rows[0]) {
    throw new AdminError(
      "SUBSCRIPTION_ITEM_NOT_FOUND",
      `The requested ${resource} item does not exist`,
      404,
    );
  }
  return result.rows[0];
}
