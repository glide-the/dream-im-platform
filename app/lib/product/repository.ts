import type { PoolClient } from "pg";
import type { PlansQuery, UsageQuery } from "./contracts";

export type ProductIdentityRow = {
  canonical_user_id: string;
  platform_user_id: string | null;
  platform_status: string | null;
  tier: string | null;
};

export async function findProductIdentityOnClient(
  client: PoolClient,
  canonicalUserId: string,
) {
  const result = await client.query<ProductIdentityRow>(
    `SELECT u.id::text AS canonical_user_id,
            pu.id AS platform_user_id,
            pu.status AS platform_status,
            pu.tier
     FROM users AS u
     LEFT JOIN platform_users AS pu
       ON pu.source = 'ink-dream'
      AND pu.external_user_id = u.id::text
     WHERE u.id = $1::bigint
     LIMIT 1`,
    [canonicalUserId],
  );
  return result.rows[0] ?? null;
}

export type ProductPlanRow = {
  plan_code: string;
  plan_name: string;
  description: string | null;
  display_eyebrow: string;
  display_note: string;
  display_details: string[];
  plan_version_id: string | null;
  version_number: number | null;
  version_status: "draft" | "published" | "retired" | null;
  allowance_tokens: string | number | null;
  base_price_microusd: string | number | null;
  currency: "USD";
  available: boolean;
};

export type ProductEntitlementRow = {
  plan_version_id: string;
  model_alias: string;
  gateway_scopes: string[];
  requests_per_minute: number | null;
  daily_token_limit: string | number | null;
  storage_bytes_limit: string | number | null;
};

const visiblePlanSql = `
  FROM subscription_plans AS plan
  LEFT JOIN LATERAL (
    SELECT version.*,
      (
        version.status = 'published'
        AND version.billing_period = 'monthly'
        AND version.allowance_microusd = 0
        AND version.overage_policy = 'deny'
        AND version.effective_from IS NULL
        AND version.allowance_tokens > 0
        AND EXISTS (
          SELECT 1
          FROM subscription_plan_entitlements AS entitlement
          JOIN ai_models AS model ON model.id = entitlement.model_id
          WHERE entitlement.plan_version_id = version.id
            AND entitlement.enabled = TRUE
            AND model.enabled = TRUE
        )
      ) AS available
    FROM subscription_plan_versions AS version
    WHERE version.plan_id = plan.id
    ORDER BY
      CASE WHEN version.status = 'published' THEN 0 ELSE 1 END,
      version.version_number DESC,
      version.id DESC
    LIMIT 1
  ) AS selected_version ON TRUE
  WHERE plan.status = 'active'
    AND plan.display_eyebrow IS NOT NULL
    AND plan.display_note IS NOT NULL`;

export async function listProductPlansOnClient(
  client: PoolClient,
  query: PlansQuery,
) {
  const count = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total ${visiblePlanSql}`,
  );
  const plans = await client.query<ProductPlanRow>(
    `SELECT plan.code AS plan_code, plan.name AS plan_name, plan.description,
            plan.display_eyebrow, plan.display_note, plan.display_details,
            selected_version.id AS plan_version_id,
            selected_version.version_number,
            selected_version.status AS version_status,
            selected_version.allowance_tokens,
            selected_version.base_price_microusd, plan.currency,
            COALESCE(selected_version.available, FALSE) AS available
     ${visiblePlanSql}
     ORDER BY CASE plan.code
       WHEN 'free' THEN 0 WHEN 'dream' THEN 1 WHEN 'is-dreaming' THEN 2 ELSE 3
     END, plan.name ASC, plan.code ASC
     LIMIT $1 OFFSET $2`,
    [query.pageSize, (query.page - 1) * query.pageSize],
  );
  const versionIds = plans.rows
    .filter((row) => row.available && row.plan_version_id !== null)
    .map((row) => row.plan_version_id as string);
  const entitlements = versionIds.length
    ? await client.query<ProductEntitlementRow>(
        `SELECT entitlement.plan_version_id, model.code AS model_alias,
                entitlement.gateway_scopes,
                entitlement.requests_per_minute,
                entitlement.daily_token_limit,
                entitlement.storage_bytes_limit
         FROM subscription_plan_entitlements AS entitlement
         JOIN ai_models AS model ON model.id = entitlement.model_id
         WHERE entitlement.plan_version_id = ANY($1::text[])
           AND entitlement.enabled = TRUE
           AND model.enabled = TRUE
         ORDER BY entitlement.plan_version_id ASC, model.code ASC`,
        [versionIds],
      )
    : { rows: [] as ProductEntitlementRow[] };
  return {
    rows: plans.rows,
    entitlements: entitlements.rows,
    total: Number(count.rows[0]?.total ?? 0),
  };
}

export type ProductSubscriptionRow = {
  subscription_id: string;
  status: string;
  subscription_version: number;
  current_plan_version_id: string;
  current_plan_code: string;
  current_plan_name: string;
  current_plan_version_number: number;
  current_allowance_tokens: string | number;
  current_base_price_microusd: string | number;
  current_currency: "USD";
  current_version_token_only: boolean;
  pending_plan_version_id: string | null;
  pending_plan_code: string | null;
  pending_plan_name: string | null;
  pending_plan_version_number: number | null;
  pending_allowance_tokens: string | number | null;
  pending_base_price_microusd: string | number | null;
  pending_currency: "USD" | null;
  pending_version_token_only: boolean | null;
  cycle_anchor_at: Date;
  current_period_number: number;
  current_period_start: Date;
  current_period_end: Date;
  renewal_enabled: boolean;
  trial_ends_at: Date | null;
  created_at: Date;
};

export type ProductAllowanceRow = {
  granted_tokens: string | number;
  reserved_tokens: string | number;
  consumed_tokens: string | number;
};

export async function findProductSubscriptionOnClient(
  client: PoolClient,
  platformUserId: string,
  callableOnly = false,
) {
  const result = await client.query<ProductSubscriptionRow>(
    `SELECT subscription.id AS subscription_id, subscription.status,
            subscription.version AS subscription_version,
            current_version.id AS current_plan_version_id,
            current_plan.code AS current_plan_code,
            current_plan.name AS current_plan_name,
            current_version.version_number AS current_plan_version_number,
            current_version.allowance_tokens AS current_allowance_tokens,
            current_version.base_price_microusd AS current_base_price_microusd,
            current_plan.currency AS current_currency,
            (
              current_version.billing_period = 'monthly'
              AND current_version.allowance_microusd = 0
              AND current_version.overage_policy = 'deny'
              AND current_version.effective_from IS NULL
            ) AS current_version_token_only,
            pending_version.id AS pending_plan_version_id,
            pending_plan.code AS pending_plan_code,
            pending_plan.name AS pending_plan_name,
            pending_version.version_number AS pending_plan_version_number,
            pending_version.allowance_tokens AS pending_allowance_tokens,
            pending_version.base_price_microusd AS pending_base_price_microusd,
            pending_plan.currency AS pending_currency,
            CASE WHEN pending_version.id IS NULL THEN NULL ELSE (
              pending_version.billing_period = 'monthly'
              AND pending_version.allowance_microusd = 0
              AND pending_version.overage_policy = 'deny'
              AND pending_version.effective_from IS NULL
            ) END AS pending_version_token_only,
            subscription.cycle_anchor_at,
            subscription.current_period_number,
            subscription.current_period_start,
            subscription.current_period_end,
            subscription.renewal_enabled,
            subscription.trial_ends_at,
            subscription.created_at
     FROM subscriptions AS subscription
     JOIN subscription_plan_versions AS current_version
       ON current_version.id = subscription.plan_version_id
     JOIN subscription_plans AS current_plan
       ON current_plan.id = current_version.plan_id
     LEFT JOIN subscription_plan_versions AS pending_version
       ON pending_version.id = subscription.pending_plan_version_id
     LEFT JOIN subscription_plans AS pending_plan
       ON pending_plan.id = pending_version.plan_id
     WHERE subscription.platform_user_id = $1
       AND ($2::boolean = FALSE OR subscription.status IN (
         'trial', 'active', 'past_due', 'paused', 'cancel_at_period_end'
       ))
     ORDER BY
       CASE WHEN subscription.status IN (
         'trial', 'active', 'past_due', 'paused', 'cancel_at_period_end'
       ) THEN 0 ELSE 1 END ASC,
       subscription.created_at DESC,
       subscription.id DESC
     LIMIT 1`,
    [platformUserId, callableOnly],
  );
  return result.rows[0] ?? null;
}

export async function findCurrentAllowanceOnClient(
  client: PoolClient,
  subscription: ProductSubscriptionRow,
) {
  const result = await client.query<ProductAllowanceRow>(
    `SELECT granted_tokens, reserved_tokens, consumed_tokens
     FROM subscription_usage_allowances
     WHERE subscription_id = $1
       AND plan_version_id = $2
       AND period_number = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [
      subscription.subscription_id,
      subscription.current_plan_version_id,
      subscription.current_period_number,
    ],
  );
  return result.rows[0] ?? null;
}

export async function listVersionEntitlementsOnClient(
  client: PoolClient,
  versionIds: string[],
) {
  if (versionIds.length === 0) return [];
  const result = await client.query<ProductEntitlementRow>(
    `SELECT entitlement.plan_version_id, model.code AS model_alias,
            entitlement.gateway_scopes,
            entitlement.requests_per_minute,
            entitlement.daily_token_limit,
            entitlement.storage_bytes_limit
     FROM subscription_plan_entitlements AS entitlement
     JOIN ai_models AS model ON model.id = entitlement.model_id
     WHERE entitlement.plan_version_id = ANY($1::text[])
       AND entitlement.enabled = TRUE
       AND model.enabled = TRUE
     ORDER BY entitlement.plan_version_id ASC, model.code ASC`,
    [versionIds],
  );
  return result.rows;
}

export type ProductUsageSummaryRow = {
  request_count: string | number;
  input_tokens: string | number;
  output_tokens: string | number;
  cache_read_tokens: string | number;
  cache_write_tokens: string | number;
  total_tokens: string | number;
  unknown_usage_count: string | number;
};

export type ProductUsageRow = {
  gateway_request_id: string;
  model_alias: string;
  protocol: "anthropic" | "openai";
  status: string;
  outcome: string;
  http_status: number | null;
  error_code: string | null;
  input_tokens: string | number;
  output_tokens: string | number;
  cache_read_tokens: string | number;
  cache_write_tokens: string | number;
  total_tokens: string | number;
  allowance_reserved_tokens: string | number;
  allowance_charged_tokens: string | number;
  occurred_at: Date;
};

function usageFilters(query: UsageQuery, startingParameter: number) {
  const clauses: string[] = [];
  const values: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    values.push(value);
    clauses.push(sql.replace("?", `$${startingParameter + values.length - 1}`));
  };
  if (query.outcome) {
    const outcome =
      query.outcome === "completed"
        ? "succeeded"
        : query.outcome === "in_progress"
          ? "pending"
          : query.outcome;
    add("request.outcome = ?", outcome);
  }
  if (query.modelAlias) add("model.code = ?", query.modelAlias);
  if (query.gatewayScope) {
    const protocol =
      query.gatewayScope === "messages:create"
        ? "anthropic"
        : query.gatewayScope === "chat:create"
          ? "openai"
          : "__unsupported__";
    add("request.protocol = ?", protocol);
  }
  if (query.settlementState) {
    const condition = {
      settled: "request.status = 'settled'",
      usage_unknown: "request.status = 'settlement_failed'",
      in_progress: "request.status IN ('received', 'reserved', 'streaming')",
      rejected: "request.status = 'rejected'",
    }[query.settlementState];
    clauses.push(condition);
  }
  return {
    sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "",
    values,
  };
}

const productTotalTokensSql = `(
  CASE WHEN request.input_token_semantics = 'fresh'
    THEN request.input_tokens + request.cache_read_tokens + request.cache_write_tokens
    ELSE request.input_tokens
  END + request.output_tokens
)`;

export async function listProductUsageOnClient(
  client: PoolClient,
  subscription: ProductSubscriptionRow,
  query: UsageQuery,
) {
  const commonParameters = [
    subscription.subscription_id,
    subscription.current_period_start,
    subscription.current_period_end,
  ];
  const filters = usageFilters(query, commonParameters.length + 1);
  const from = `
    FROM gateway_requests AS request
    JOIN ai_models AS model ON model.id = request.model_id
    WHERE request.subscription_id = $1
      AND request.created_at >= $2
      AND request.created_at < $3
      AND request.subscription_coverage_mode = 'token_allowance'`;
  const summary = await client.query<ProductUsageSummaryRow>(
    `SELECT COUNT(*)::text AS request_count,
            COALESCE(SUM(request.input_tokens), 0)::text AS input_tokens,
            COALESCE(SUM(request.output_tokens), 0)::text AS output_tokens,
            COALESCE(SUM(request.cache_read_tokens), 0)::text AS cache_read_tokens,
            COALESCE(SUM(request.cache_write_tokens), 0)::text AS cache_write_tokens,
            COALESCE(SUM(${productTotalTokensSql}), 0)::text AS total_tokens,
            COUNT(*) FILTER (
              WHERE request.status = 'settlement_failed'
            )::text AS unknown_usage_count
     ${from}`,
    commonParameters,
  );
  const count = await client.query<{ total: string }>(
    `SELECT COUNT(*)::text AS total ${from}${filters.sql}`,
    [...commonParameters, ...filters.values],
  );
  const sortSql = {
    occurredAt: "COALESCE(request.settled_at, request.completed_at, request.created_at)",
    totalTokens: productTotalTokensSql,
    modelAlias: "model.code",
    outcome: "request.outcome",
  }[query.sort];
  const direction = query.order === "asc" ? "ASC" : "DESC";
  const rows = await client.query<ProductUsageRow>(
    `SELECT request.id AS gateway_request_id, model.code AS model_alias,
            request.protocol, request.status, request.outcome,
            request.http_status, request.error_code,
            request.input_tokens, request.output_tokens,
            request.cache_read_tokens, request.cache_write_tokens,
            ${productTotalTokensSql} AS total_tokens,
            request.allowance_reserved_tokens,
            request.allowance_charged_tokens,
            COALESCE(
              request.settled_at, request.completed_at, request.created_at
            ) AS occurred_at
     ${from}${filters.sql}
     ORDER BY ${sortSql} ${direction}, request.id ${direction}
     LIMIT $${commonParameters.length + filters.values.length + 1}
     OFFSET $${commonParameters.length + filters.values.length + 2}`,
    [
      ...commonParameters,
      ...filters.values,
      query.pageSize,
      (query.page - 1) * query.pageSize,
    ],
  );
  return {
    summary: summary.rows[0],
    total: Number(count.rows[0]?.total ?? 0),
    rows: rows.rows,
  };
}

export type ProductModelRow = {
  model_alias: string;
  display_name: string;
  capabilities: Record<string, boolean> | null;
  context_window: number | null;
  max_output_tokens: number | null;
  gateway_scopes: string[];
  entitlement_rpm: number | null;
  entitlement_daily_tokens: string | number | null;
  entitlement_storage_bytes: string | number | null;
  user_rpm: number | null;
  user_daily_tokens: string | number | null;
  subscription_status: string;
  current_period_end: Date;
  granted_tokens: string | number;
  reserved_tokens: string | number;
  consumed_tokens: string | number;
};

export async function listProductModelsOnClient(
  client: PoolClient,
  principal: { platformUserId: string; tier: string },
) {
  const result = await client.query<ProductModelRow>(
    `SELECT model.code AS model_alias, model.display_name,
            model.capabilities, model.context_window,
            model.max_output_tokens, entitlement.gateway_scopes,
            entitlement.requests_per_minute AS entitlement_rpm,
            entitlement.daily_token_limit AS entitlement_daily_tokens,
            entitlement.storage_bytes_limit AS entitlement_storage_bytes,
            user_permission.requests_per_minute AS user_rpm,
            user_permission.daily_token_limit AS user_daily_tokens,
            subscription.status AS subscription_status,
            subscription.current_period_end,
            allowance.granted_tokens, allowance.reserved_tokens,
            allowance.consumed_tokens
     FROM subscriptions AS subscription
     JOIN subscription_plan_versions AS version
       ON version.id = subscription.plan_version_id
     JOIN subscription_plan_entitlements AS entitlement
       ON entitlement.plan_version_id = version.id
      AND entitlement.enabled = TRUE
     JOIN ai_models AS model
       ON model.id = entitlement.model_id
      AND model.enabled = TRUE
     JOIN ai_providers AS routing_service
       ON routing_service.id = model.provider_id
      AND routing_service.status = 'active'
      AND routing_service.api_key_ciphertext IS NOT NULL
      AND routing_service.api_key_iv IS NOT NULL
      AND routing_service.api_key_tag IS NOT NULL
     LEFT JOIN user_model_permissions AS user_permission
       ON user_permission.platform_user_id = subscription.platform_user_id
      AND user_permission.model_id = model.id
     JOIN subscription_usage_allowances AS allowance
       ON allowance.subscription_id = subscription.id
      AND allowance.period_start = subscription.current_period_start
      AND allowance.period_end = subscription.current_period_end
     WHERE subscription.platform_user_id = $1
       AND (
         subscription.status IN ('active', 'cancel_at_period_end')
         OR (
           subscription.status = 'trial'
           AND subscription.trial_ends_at IS NOT NULL
           AND subscription.trial_ends_at > NOW()
         )
       )
       AND subscription.current_period_start <= NOW()
       AND subscription.current_period_end > NOW()
       AND version.status = 'published'
       AND version.billing_period = 'monthly'
       AND version.allowance_microusd = 0
       AND version.overage_policy = 'deny'
       AND version.effective_from IS NULL
       AND COALESCE(user_permission.enabled, TRUE) = TRUE
       AND EXISTS (
         SELECT 1
         FROM ai_pricing_rules AS routing_rule
         WHERE routing_rule.model_id = model.id
           AND routing_rule.status = 'active'
           AND routing_rule.user_tier IN ($2, 'default')
           AND routing_rule.effective_from <= NOW()
           AND (routing_rule.effective_to IS NULL OR routing_rule.effective_to > NOW())
       )
     ORDER BY model.display_name ASC, model.code ASC`,
    [principal.platformUserId, principal.tier],
  );
  return result.rows;
}

export type ProductTargetVersionRow = {
  plan_code: string;
  plan_name: string;
  plan_version_id: string;
  version_number: number;
  allowance_tokens: string | number;
  base_price_microusd: string | number;
  currency: "USD";
};

export async function findProductTargetVersionOnClient(
  client: PoolClient,
  planVersionId: string,
) {
  const result = await client.query<ProductTargetVersionRow>(
    `SELECT plan.code AS plan_code, plan.name AS plan_name, plan.currency,
            version.id AS plan_version_id,
            version.version_number, version.allowance_tokens,
            version.base_price_microusd
     FROM subscription_plan_versions AS version
     JOIN subscription_plans AS plan ON plan.id = version.plan_id
     WHERE version.id = $1
       AND plan.status = 'active'
       AND version.status = 'published'
       AND version.billing_period = 'monthly'
       AND version.allowance_microusd = 0
       AND version.overage_policy = 'deny'
       AND version.effective_from IS NULL
       AND version.allowance_tokens > 0
       AND EXISTS (
         SELECT 1 FROM subscription_plan_entitlements AS entitlement
         WHERE entitlement.plan_version_id = version.id
           AND entitlement.enabled = TRUE
       )
     LIMIT 1`,
    [planVersionId],
  );
  return result.rows[0] ?? null;
}

export async function productTransactionTimeOnClient(client: PoolClient) {
  const result = await client.query<{ as_of: Date }>(
    "SELECT transaction_timestamp() AS as_of",
  );
  return result.rows[0]?.as_of ?? new Date();
}
