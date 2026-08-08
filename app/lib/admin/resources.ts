import type { PoolClient } from "pg";
import { withPlatformClient } from "../platform-db";
import { AdminError, adminErrorResponse } from "./errors";
import {
  adminRequestId,
  requireAdminRequest,
} from "./guard";
import {
  adminListResponse,
  buildAdminListClauses,
  parseAdminListQuery,
} from "./list-query";
import {
  isStorySourceResource,
  queryStorySourceItem,
  queryStorySourceList,
  storySourcePermission,
} from "../story-source/repository";

export type AdminResource =
  | "platform-users"
  | "providers"
  | "models"
  | "pricing-rules"
  | "billing-accounts"
  | "usage"
  | "ledger"
  | "gateway-requests"
  | "gateway-api-keys"
  | "gateway-rate-limits"
  | "user-model-permissions"
  | "admin-users"
  | "admin-roles"
  | "admin-permissions"
  | "system-settings"
  | "audit-logs";

type ResourceConfig = {
  permission: string;
  select: string;
  from: string;
  columns: Record<string, string>;
  defaultSort: string;
  filterFields: string[];
};

const resources: Record<AdminResource, ResourceConfig> = {
  "platform-users": {
    permission: "users.read",
    select: `u.id, u.source, u.external_user_id, u.email, u.display_name,
             u.tier, u.status, u.daily_token_limit, u.monthly_token_limit,
             u.created_at, u.updated_at`,
    from: "FROM platform_users AS u",
    columns: {
      id: "u.id",
      source: "u.source",
      email: "u.email",
      tier: "u.tier",
      status: "u.status",
      created_at: "u.created_at",
      updated_at: "u.updated_at",
    },
    defaultSort: "created_at",
    filterFields: ["source", "email", "tier", "status"],
  },
  providers: {
    permission: "providers.read",
    select: `p.id, p.code, p.name, p.protocol, p.base_url, p.status,
             p.timeout_ms, p.max_retries, p.api_key_fingerprint,
             (p.api_key_ciphertext IS NOT NULL) AS credential_configured,
             p.config, p.created_at, p.updated_at`,
    from: "FROM ai_providers AS p",
    columns: {
      id: "p.id",
      code: "p.code",
      name: "p.name",
      protocol: "p.protocol",
      status: "p.status",
      created_at: "p.created_at",
      updated_at: "p.updated_at",
    },
    defaultSort: "created_at",
    filterFields: ["code", "name", "protocol", "status"],
  },
  models: {
    permission: "models.read",
    select: `m.id, m.provider_id, p.code AS provider_code,
             m.code, m.upstream_model, m.display_name, m.context_window,
             m.max_output_tokens, m.capabilities, m.enabled,
             m.created_at, m.updated_at`,
    from: "FROM ai_models AS m JOIN ai_providers AS p ON p.id = m.provider_id",
    columns: {
      id: "m.id",
      provider_id: "m.provider_id",
      provider_code: "p.code",
      code: "m.code",
      display_name: "m.display_name",
      enabled: "m.enabled::text",
      created_at: "m.created_at",
      updated_at: "m.updated_at",
    },
    defaultSort: "created_at",
    filterFields: ["provider_id", "provider_code", "code", "display_name", "enabled"],
  },
  "pricing-rules": {
    permission: "pricing.read",
    select: `pr.id, pr.model_id, m.code AS model_code, pr.user_tier,
             pr.input_price_microusd_per_million,
             pr.output_price_microusd_per_million,
             pr.cache_read_price_microusd_per_million,
             pr.cache_write_price_microusd_per_million,
             pr.markup_bps, pr.discount_bps, pr.status,
             pr.effective_from, pr.effective_to, pr.created_at, pr.updated_at`,
    from: "FROM ai_pricing_rules AS pr JOIN ai_models AS m ON m.id = pr.model_id",
    columns: {
      id: "pr.id",
      model_id: "pr.model_id",
      model_code: "m.code",
      user_tier: "pr.user_tier",
      status: "pr.status",
      effective_from: "pr.effective_from",
      created_at: "pr.created_at",
      updated_at: "pr.updated_at",
    },
    defaultSort: "effective_from",
    filterFields: ["model_id", "model_code", "user_tier", "status"],
  },
  "billing-accounts": {
    permission: "billing.read",
    select: `a.id, a.platform_user_id, u.email, u.display_name, u.tier,
             a.currency, a.available_microusd, a.reserved_microusd,
             a.lifetime_debited_microusd, a.version,
             a.created_at, a.updated_at`,
    from: "FROM billing_accounts AS a JOIN platform_users AS u ON u.id = a.platform_user_id",
    columns: {
      id: "a.id",
      platform_user_id: "a.platform_user_id",
      email: "u.email",
      tier: "u.tier",
      available_microusd: "a.available_microusd",
      created_at: "a.created_at",
      updated_at: "a.updated_at",
    },
    defaultSort: "updated_at",
    filterFields: ["platform_user_id", "email", "tier"],
  },
  usage: {
    permission: "billing.read",
    select: `r.id, r.platform_user_id, u.email, r.requested_model,
             r.resolved_model, r.protocol, r.outcome,
             r.input_tokens, r.output_tokens, r.cache_read_tokens,
             r.cache_write_tokens, r.provider_cost_microusd,
             r.charged_microusd, r.created_at, r.settled_at`,
    from: "FROM gateway_requests AS r JOIN platform_users AS u ON u.id = r.platform_user_id",
    columns: {
      id: "r.id",
      platform_user_id: "r.platform_user_id",
      email: "u.email",
      requested_model: "r.requested_model",
      protocol: "r.protocol",
      outcome: "r.outcome",
      created_at: "r.created_at",
      settled_at: "r.settled_at",
    },
    defaultSort: "created_at",
    filterFields: ["platform_user_id", "email", "requested_model", "protocol", "outcome"],
  },
  ledger: {
    permission: "billing.read",
    select: `l.id, l.account_id, l.platform_user_id, u.email,
             l.gateway_request_id, l.entry_type, l.amount_microusd,
             l.available_before_microusd, l.available_after_microusd,
             l.reserved_before_microusd, l.reserved_after_microusd,
             l.description, l.actor_type, l.actor_id, l.created_at`,
    from: "FROM billing_ledger_entries AS l JOIN platform_users AS u ON u.id = l.platform_user_id",
    columns: {
      id: "l.id",
      account_id: "l.account_id",
      platform_user_id: "l.platform_user_id",
      email: "u.email",
      gateway_request_id: "l.gateway_request_id",
      entry_type: "l.entry_type",
      actor_type: "l.actor_type",
      created_at: "l.created_at",
    },
    defaultSort: "created_at",
    filterFields: ["account_id", "platform_user_id", "email", "gateway_request_id", "entry_type", "actor_type"],
  },
  "gateway-requests": {
    permission: "gateway.read",
    select: `r.id, r.platform_user_id, u.email, r.provider_id,
             p.code AS provider_code, r.model_id, r.requested_model,
             r.resolved_model, r.upstream_request_id, r.protocol,
             r.status, r.outcome, r.is_streaming, r.http_status,
             r.error_code, r.input_tokens, r.output_tokens,
             r.cache_read_tokens, r.cache_write_tokens,
             r.provider_cost_microusd, r.charged_microusd,
             r.first_token_ms, r.latency_ms, r.created_at,
             r.completed_at, r.settled_at`,
    from: `FROM gateway_requests AS r
           JOIN platform_users AS u ON u.id = r.platform_user_id
           JOIN ai_providers AS p ON p.id = r.provider_id`,
    columns: {
      id: "r.id",
      platform_user_id: "r.platform_user_id",
      email: "u.email",
      provider_code: "p.code",
      requested_model: "r.requested_model",
      protocol: "r.protocol",
      status: "r.status",
      outcome: "r.outcome",
      error_code: "r.error_code",
      created_at: "r.created_at",
      completed_at: "r.completed_at",
    },
    defaultSort: "created_at",
    filterFields: ["platform_user_id", "email", "provider_code", "requested_model", "protocol", "status", "outcome", "error_code"],
  },
  "gateway-api-keys": {
    permission: "gateway.read",
    select: `k.id, k.platform_user_id, u.email, k.name, k.key_prefix,
             k.scopes, k.status, k.expires_at, k.last_used_at,
             k.revoked_at, k.created_at`,
    from: "FROM gateway_api_keys AS k JOIN platform_users AS u ON u.id = k.platform_user_id",
    columns: {
      id: "k.id",
      platform_user_id: "k.platform_user_id",
      email: "u.email",
      name: "k.name",
      key_prefix: "k.key_prefix",
      status: "k.status",
      expires_at: "k.expires_at",
      created_at: "k.created_at",
    },
    defaultSort: "created_at",
    filterFields: ["platform_user_id", "email", "name", "key_prefix", "status"],
  },
  "gateway-rate-limits": {
    permission: "gateway.read",
    select: `l.platform_user_id || ':' || l.model_id || ':' || l.window_type || ':' ||
             extract(epoch FROM l.window_start)::bigint::text AS id,
             l.platform_user_id, u.email, l.model_id, m.code AS model_code,
             l.window_type, l.window_start, l.request_count, l.token_count,
             l.updated_at`,
    from: `FROM gateway_rate_limits AS l
           JOIN platform_users AS u ON u.id = l.platform_user_id
           JOIN ai_models AS m ON m.id = l.model_id`,
    columns: {
      id: "l.platform_user_id || ':' || l.model_id || ':' || l.window_type || ':' || extract(epoch FROM l.window_start)::bigint::text",
      platform_user_id: "l.platform_user_id",
      email: "u.email",
      model_id: "l.model_id",
      model_code: "m.code",
      window_type: "l.window_type",
      window_start: "l.window_start",
      request_count: "l.request_count",
      token_count: "l.token_count",
      updated_at: "l.updated_at",
    },
    defaultSort: "window_start",
    filterFields: [
      "platform_user_id",
      "email",
      "model_id",
      "model_code",
      "window_type",
    ],
  },
  "user-model-permissions": {
    permission: "users.read",
    select: `ump.id, ump.platform_user_id, u.email, ump.model_id,
             m.code AS model_code, ump.enabled, ump.requests_per_minute,
             ump.daily_token_limit, ump.monthly_token_limit,
             ump.created_at, ump.updated_at`,
    from: `FROM user_model_permissions AS ump
           JOIN platform_users AS u ON u.id = ump.platform_user_id
           JOIN ai_models AS m ON m.id = ump.model_id`,
    columns: {
      id: "ump.id",
      platform_user_id: "ump.platform_user_id",
      email: "u.email",
      model_id: "ump.model_id",
      model_code: "m.code",
      enabled: "ump.enabled::text",
      requests_per_minute: "ump.requests_per_minute",
      daily_token_limit: "ump.daily_token_limit",
      monthly_token_limit: "ump.monthly_token_limit",
      created_at: "ump.created_at",
      updated_at: "ump.updated_at",
    },
    defaultSort: "updated_at",
    filterFields: [
      "platform_user_id",
      "email",
      "model_id",
      "model_code",
      "enabled",
    ],
  },
  "admin-users": {
    permission: "access.read",
    select: `u.id, u.email, u.display_name, u.status, u.last_login_at,
             COALESCE(role_projection.roles, ARRAY[]::text[]) AS roles,
             u.created_at, u.updated_at`,
    from: `FROM admin_users AS u
           LEFT JOIN LATERAL (
             SELECT array_agg(r.code ORDER BY r.code) AS roles
             FROM admin_user_roles AS ur
             JOIN admin_roles AS r ON r.id = ur.role_id
             WHERE ur.admin_user_id = u.id
           ) AS role_projection ON TRUE`,
    columns: {
      id: "u.id",
      email: "u.email",
      display_name: "u.display_name",
      status: "u.status",
      last_login_at: "u.last_login_at",
      created_at: "u.created_at",
      updated_at: "u.updated_at",
    },
    defaultSort: "created_at",
    filterFields: ["email", "display_name", "status"],
  },
  "admin-roles": {
    permission: "access.read",
    select: `r.id, r.code, r.name, r.description,
             COALESCE(permission_projection.permissions, ARRAY[]::text[]) AS permissions,
             r.created_at`,
    from: `FROM admin_roles AS r
           LEFT JOIN LATERAL (
             SELECT array_agg(p.code ORDER BY p.code) AS permissions
             FROM admin_role_permissions AS rp
             JOIN admin_permissions AS p ON p.id = rp.permission_id
             WHERE rp.role_id = r.id
           ) AS permission_projection ON TRUE`,
    columns: {
      id: "r.id",
      code: "r.code",
      name: "r.name",
      created_at: "r.created_at",
    },
    defaultSort: "code",
    filterFields: ["code", "name"],
  },
  "admin-permissions": {
    permission: "access.read",
    select: `p.id, p.code, p.name, p.description, p.created_at`,
    from: "FROM admin_permissions AS p",
    columns: {
      id: "p.id",
      code: "p.code",
      name: "p.name",
      created_at: "p.created_at",
    },
    defaultSort: "code",
    filterFields: ["code", "name"],
  },
  "system-settings": {
    permission: "system.read",
    select: `s.id, s.category, s.key,
             CASE WHEN s.is_secret THEN '{\"masked\":true}'::jsonb ELSE s.value END AS value,
             s.description, s.is_secret, s.status, s.created_at, s.updated_at`,
    from: "FROM system_settings AS s",
    columns: {
      id: "s.id",
      category: "s.category",
      key: "s.key",
      is_secret: "s.is_secret::text",
      status: "s.status",
      created_at: "s.created_at",
      updated_at: "s.updated_at",
    },
    defaultSort: "updated_at",
    filterFields: ["category", "key", "is_secret", "status"],
  },
  "audit-logs": {
    permission: "audit.read",
    select: `a.id, a.actor_type, a.actor_id, u.email AS actor_email,
             a.action, a.resource_type, a.resource_id, a.request_id,
             a.ip_address, a.user_agent, a.before, a.after,
             a.metadata, a.created_at`,
    from: "FROM admin_audit_logs AS a LEFT JOIN admin_users AS u ON u.id = a.actor_id",
    columns: {
      id: "a.id",
      actor_type: "a.actor_type",
      actor_id: "a.actor_id",
      actor_email: "u.email",
      action: "a.action",
      resource_type: "a.resource_type",
      resource_id: "a.resource_id",
      request_id: "a.request_id",
      created_at: "a.created_at",
    },
    defaultSort: "created_at",
    filterFields: ["actor_type", "actor_id", "actor_email", "action", "resource_type", "resource_id", "request_id"],
  },
};

function resourceConfig(resource: string): ResourceConfig {
  const config = resources[resource as AdminResource];
  if (!config) {
    throw new AdminError(
      "ADMIN_RESOURCE_NOT_FOUND",
      `Admin resource ${resource} does not exist`,
      404,
    );
  }
  return config;
}

export function adminResourcePermission(resource: string) {
  if (isStorySourceResource(resource)) {
    return storySourcePermission(resource);
  }
  return resourceConfig(resource).permission;
}

async function queryList(client: PoolClient, request: Request, config: ResourceConfig) {
  const fields = Object.keys(config.columns);
  const query = parseAdminListQuery(request, {
    sortFields: fields,
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
  const total = Number(count.rows[0]?.total ?? 0);
  if (!Number.isSafeInteger(total)) {
    throw new AdminError(
      "ADMIN_TOTAL_INVALID",
      "The resource total is outside the supported range",
      500,
    );
  }
  return adminListResponse(data.rows, query, total);
}

export async function handleAdminResourceList(
  request: Request,
  resource: string,
) {
  const requestId = adminRequestId(request);
  try {
    if (isStorySourceResource(resource)) {
      await requireAdminRequest(request, storySourcePermission(resource));
      const response = await queryStorySourceList(request, resource);
      return Response.json(response, {
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      });
    }
    const config = resourceConfig(resource);
    await requireAdminRequest(request, config.permission);
    const response = await withPlatformClient(
      async (client) => await queryList(client, request, config),
    );
    return Response.json(response, {
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
      },
    });
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}

export async function handleAdminResourceGetOne(
  request: Request,
  resource: string,
  id: string,
) {
  const requestId = adminRequestId(request);
  try {
    if (isStorySourceResource(resource)) {
      await requireAdminRequest(request, storySourcePermission(resource));
      const data = await queryStorySourceItem(resource, id);
      return Response.json(
        { data },
        {
          headers: {
            "cache-control": "no-store",
            "x-request-id": requestId,
          },
        },
      );
    }
    const config = resourceConfig(resource);
    await requireAdminRequest(request, config.permission);
    const data = await withPlatformClient(async (client) => {
      const result = await client.query<Record<string, unknown>>(
        `SELECT ${config.select} ${config.from}
         WHERE ${config.columns.id} = $1
         LIMIT 1`,
        [id],
      );
      if (!result.rows[0]) {
        throw new AdminError(
          "ADMIN_RESOURCE_ITEM_NOT_FOUND",
          `The requested ${resource} item does not exist`,
          404,
        );
      }
      return result.rows[0];
    });
    return Response.json(
      { data },
      {
        headers: {
          "cache-control": "no-store",
          "x-request-id": requestId,
        },
      },
    );
  } catch (error) {
    return adminErrorResponse(error, requestId);
  }
}
