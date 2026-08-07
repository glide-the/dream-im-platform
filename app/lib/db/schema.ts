import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { Conversation, DecisionChainItem, SystemConfig } from "../types";

export const customers = pgTable("customers", {
  id: text("id").primaryKey(),
  name: text("name"),
  company: text("company"),
  title: text("title"),
  phones: text("phones").array(),
  emails: text("emails").array(),
  wechat: text("wechat"),
  address: text("address"),
  tags: text("tags").array(),
  decision_chain: jsonb("decision_chain").$type<DecisionChainItem[]>(),
  profile_markdown: text("profile_markdown"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  source: text("source"),
  last_verified_at: timestamp("last_verified_at", {
    withTimezone: true,
    mode: "date"
  })
});

export const todos = pgTable("todos", {
  id: text("id").primaryKey(),
  title: text("title"),
  description: text("description"),
  priority: text("priority"),
  status: text("status"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
});

export const conversations = pgTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title"),
  status: text("status"),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  messages: jsonb("messages").$type<Conversation["messages"]>(),
  attachments: jsonb("attachments").$type<Conversation["attachments"]>(),
  context_customer_ids: text("context_customer_ids").array(),
  ai_outputs: jsonb("ai_outputs").$type<Conversation["ai_outputs"]>(),
  linked_customer_id: text("linked_customer_id"),
  /** Claude SDK session_id for resuming conversations */
  claude_session_id: text("claude_session_id")
});

export const systemConfigs = pgTable("system_configs", {
  /** Singleton row — use "default" as the primary key */
  id: text("id").primaryKey().default("default"),
  /** System prompt sent to the agent */
  system_prompt: text("system_prompt"),
  /** Model identifier, e.g. "claude-sonnet-4-20250514" */
  model: text("model"),
  /** Model provider, e.g. "anthropic" */
  provider: text("provider"),
  /** Theme preference: "light" | "dark" | "system" */
  theme: text("theme"),
  /** Whether workspace file access is enabled */
  workspace_enabled: boolean("workspace_enabled").default(true),
  /** Extra settings (future-proof) */
  extras: jsonb("extras").$type<SystemConfig["extras"]>(),
  created_at: timestamp("created_at", { withTimezone: true, mode: "date" }),
  updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" }),
});

/**
 * AI platform control-plane schema.
 *
 * Monetary columns use integer micro-USD (1 USD = 1_000_000 micro-USD). This
 * keeps billing arithmetic deterministic and avoids floating point drift.
 */

export const platformUsers = pgTable(
  "platform_users",
  {
    id: text("id").primaryKey(),
    source: text("source").notNull(),
    external_user_id: text("external_user_id").notNull(),
    email: text("email"),
    display_name: text("display_name"),
    tier: text("tier").notNull().default("free"),
    status: text("status").notNull().default("active"),
    daily_token_limit: bigint("daily_token_limit", { mode: "number" }),
    monthly_token_limit: bigint("monthly_token_limit", { mode: "number" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("platform_users_source_external_uidx").on(
      table.source,
      table.external_user_id,
    ),
    index("platform_users_status_idx").on(table.status),
    index("platform_users_email_idx").on(table.email),
    check(
      "platform_users_daily_token_limit_check",
      sql`${table.daily_token_limit} IS NULL OR ${table.daily_token_limit} >= 0`,
    ),
    check(
      "platform_users_monthly_token_limit_check",
      sql`${table.monthly_token_limit} IS NULL OR ${table.monthly_token_limit} >= 0`,
    ),
  ],
);

export const aiProviders = pgTable(
  "ai_providers",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    protocol: text("protocol").notNull(),
    base_url: text("base_url").notNull(),
    api_key_ciphertext: text("api_key_ciphertext"),
    api_key_iv: text("api_key_iv"),
    api_key_tag: text("api_key_tag"),
    api_key_fingerprint: text("api_key_fingerprint"),
    status: text("status").notNull().default("disabled"),
    timeout_ms: integer("timeout_ms").notNull().default(120_000),
    max_retries: integer("max_retries").notNull().default(1),
    config: jsonb("config").$type<Record<string, unknown>>().default({}),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_providers_code_uidx").on(table.code),
    index("ai_providers_status_idx").on(table.status),
    check(
      "ai_providers_protocol_check",
      sql`${table.protocol} IN ('anthropic', 'openai')`,
    ),
    check("ai_providers_timeout_check", sql`${table.timeout_ms} > 0`),
    check(
      "ai_providers_retries_check",
      sql`${table.max_retries} BETWEEN 0 AND 5`,
    ),
  ],
);

export const aiModels = pgTable(
  "ai_models",
  {
    id: text("id").primaryKey(),
    provider_id: text("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "restrict" }),
    code: text("code").notNull(),
    upstream_model: text("upstream_model").notNull(),
    display_name: text("display_name").notNull(),
    context_window: integer("context_window"),
    max_output_tokens: integer("max_output_tokens"),
    capabilities: jsonb("capabilities")
      .$type<Record<string, boolean>>()
      .default({}),
    enabled: boolean("enabled").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_models_code_uidx").on(table.code),
    uniqueIndex("ai_models_provider_upstream_uidx").on(
      table.provider_id,
      table.upstream_model,
    ),
    index("ai_models_provider_idx").on(table.provider_id),
    index("ai_models_enabled_idx").on(table.enabled),
  ],
);

export const aiPricingRules = pgTable(
  "ai_pricing_rules",
  {
    id: text("id").primaryKey(),
    model_id: text("model_id")
      .notNull()
      .references(() => aiModels.id, { onDelete: "restrict" }),
    user_tier: text("user_tier").notNull().default("default"),
    input_price_microusd_per_million: bigint(
      "input_price_microusd_per_million",
      { mode: "number" },
    ).notNull(),
    output_price_microusd_per_million: bigint(
      "output_price_microusd_per_million",
      { mode: "number" },
    ).notNull(),
    cache_read_price_microusd_per_million: bigint(
      "cache_read_price_microusd_per_million",
      { mode: "number" },
    )
      .notNull()
      .default(0),
    cache_write_price_microusd_per_million: bigint(
      "cache_write_price_microusd_per_million",
      { mode: "number" },
    )
      .notNull()
      .default(0),
    markup_bps: integer("markup_bps").notNull().default(0),
    discount_bps: integer("discount_bps").notNull().default(0),
    status: text("status").notNull().default("active"),
    effective_from: timestamp("effective_from", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    effective_to: timestamp("effective_to", {
      withTimezone: true,
      mode: "date",
    }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_pricing_rules_lookup_idx").on(
      table.model_id,
      table.user_tier,
      table.status,
      table.effective_from,
    ),
    check(
      "ai_pricing_rules_input_price_check",
      sql`${table.input_price_microusd_per_million} >= 0`,
    ),
    check(
      "ai_pricing_rules_output_price_check",
      sql`${table.output_price_microusd_per_million} >= 0`,
    ),
    check(
      "ai_pricing_rules_cache_read_price_check",
      sql`${table.cache_read_price_microusd_per_million} >= 0`,
    ),
    check(
      "ai_pricing_rules_cache_write_price_check",
      sql`${table.cache_write_price_microusd_per_million} >= 0`,
    ),
    check(
      "ai_pricing_rules_markup_check",
      sql`${table.markup_bps} BETWEEN 0 AND 100000`,
    ),
    check(
      "ai_pricing_rules_discount_check",
      sql`${table.discount_bps} BETWEEN 0 AND 10000`,
    ),
    check(
      "ai_pricing_rules_effective_window_check",
      sql`${table.effective_to} IS NULL OR ${table.effective_to} > ${table.effective_from}`,
    ),
  ],
);

export const billingAccounts = pgTable(
  "billing_accounts",
  {
    id: text("id").primaryKey(),
    platform_user_id: text("platform_user_id")
      .notNull()
      .references(() => platformUsers.id, { onDelete: "restrict" }),
    currency: text("currency").notNull().default("USD"),
    available_microusd: bigint("available_microusd", { mode: "number" })
      .notNull()
      .default(0),
    reserved_microusd: bigint("reserved_microusd", { mode: "number" })
      .notNull()
      .default(0),
    lifetime_debited_microusd: bigint("lifetime_debited_microusd", {
      mode: "number",
    })
      .notNull()
      .default(0),
    version: integer("version").notNull().default(1),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_accounts_user_uidx").on(table.platform_user_id),
    check(
      "billing_accounts_reserved_check",
      sql`${table.reserved_microusd} >= 0`,
    ),
    check(
      "billing_accounts_lifetime_debited_check",
      sql`${table.lifetime_debited_microusd} >= 0`,
    ),
  ],
);

export const gatewayApiKeys = pgTable(
  "gateway_api_keys",
  {
    id: text("id").primaryKey(),
    platform_user_id: text("platform_user_id")
      .notNull()
      .references(() => platformUsers.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    key_prefix: text("key_prefix").notNull(),
    key_hash: text("key_hash").notNull(),
    scopes: text("scopes").array().notNull(),
    status: text("status").notNull().default("active"),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    last_used_at: timestamp("last_used_at", {
      withTimezone: true,
      mode: "date",
    }),
    revoked_at: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("gateway_api_keys_hash_uidx").on(table.key_hash),
    index("gateway_api_keys_user_idx").on(table.platform_user_id),
    index("gateway_api_keys_prefix_idx").on(table.key_prefix),
  ],
);

export const userModelPermissions = pgTable(
  "user_model_permissions",
  {
    id: text("id").primaryKey(),
    platform_user_id: text("platform_user_id")
      .notNull()
      .references(() => platformUsers.id, { onDelete: "cascade" }),
    model_id: text("model_id")
      .notNull()
      .references(() => aiModels.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(true),
    requests_per_minute: integer("requests_per_minute"),
    daily_token_limit: bigint("daily_token_limit", { mode: "number" }),
    monthly_token_limit: bigint("monthly_token_limit", { mode: "number" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("user_model_permissions_user_model_uidx").on(
      table.platform_user_id,
      table.model_id,
    ),
  ],
);

export const gatewayRequests = pgTable(
  "gateway_requests",
  {
    id: text("id").primaryKey(),
    idempotency_key: text("idempotency_key"),
    platform_user_id: text("platform_user_id")
      .notNull()
      .references(() => platformUsers.id, { onDelete: "restrict" }),
    gateway_api_key_id: text("gateway_api_key_id")
      .notNull()
      .references(() => gatewayApiKeys.id, { onDelete: "restrict" }),
    provider_id: text("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "restrict" }),
    model_id: text("model_id")
      .notNull()
      .references(() => aiModels.id, { onDelete: "restrict" }),
    pricing_rule_id: text("pricing_rule_id")
      .notNull()
      .references(() => aiPricingRules.id, { onDelete: "restrict" }),
    protocol: text("protocol").notNull(),
    requested_model: text("requested_model").notNull(),
    resolved_model: text("resolved_model").notNull(),
    upstream_request_id: text("upstream_request_id"),
    status: text("status").notNull().default("received"),
    outcome: text("outcome").notNull().default("pending"),
    input_token_semantics: text("input_token_semantics").notNull(),
    input_tokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
    output_tokens: bigint("output_tokens", { mode: "number" })
      .notNull()
      .default(0),
    cache_read_tokens: bigint("cache_read_tokens", { mode: "number" })
      .notNull()
      .default(0),
    cache_write_tokens: bigint("cache_write_tokens", { mode: "number" })
      .notNull()
      .default(0),
    input_price_snapshot: bigint("input_price_snapshot", { mode: "number" })
      .notNull(),
    output_price_snapshot: bigint("output_price_snapshot", { mode: "number" })
      .notNull(),
    cache_read_price_snapshot: bigint("cache_read_price_snapshot", {
      mode: "number",
    })
      .notNull()
      .default(0),
    cache_write_price_snapshot: bigint("cache_write_price_snapshot", {
      mode: "number",
    })
      .notNull()
      .default(0),
    markup_bps_snapshot: integer("markup_bps_snapshot").notNull().default(0),
    discount_bps_snapshot: integer("discount_bps_snapshot").notNull().default(0),
    reserved_microusd: bigint("reserved_microusd", { mode: "number" })
      .notNull()
      .default(0),
    provider_cost_microusd: bigint("provider_cost_microusd", { mode: "number" })
      .notNull()
      .default(0),
    charged_microusd: bigint("charged_microusd", { mode: "number" })
      .notNull()
      .default(0),
    is_streaming: boolean("is_streaming").notNull().default(false),
    http_status: integer("http_status"),
    error_code: text("error_code"),
    error_message: text("error_message"),
    first_token_ms: integer("first_token_ms"),
    latency_ms: integer("latency_ms"),
    response_summary: jsonb("response_summary").$type<Record<string, unknown>>(),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    started_at: timestamp("started_at", { withTimezone: true, mode: "date" }),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    settled_at: timestamp("settled_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    uniqueIndex("gateway_requests_user_idempotency_uidx").on(
      table.platform_user_id,
      table.idempotency_key,
    ),
    index("gateway_requests_created_idx").on(table.created_at),
    index("gateway_requests_user_created_idx").on(
      table.platform_user_id,
      table.created_at,
    ),
    index("gateway_requests_status_idx").on(table.status),
    index("gateway_requests_upstream_idx").on(table.upstream_request_id),
    check(
      "gateway_requests_input_tokens_check",
      sql`${table.input_tokens} >= 0`,
    ),
    check(
      "gateway_requests_output_tokens_check",
      sql`${table.output_tokens} >= 0`,
    ),
    check(
      "gateway_requests_cache_read_tokens_check",
      sql`${table.cache_read_tokens} >= 0`,
    ),
    check(
      "gateway_requests_cache_write_tokens_check",
      sql`${table.cache_write_tokens} >= 0`,
    ),
    check(
      "gateway_requests_money_check",
      sql`${table.reserved_microusd} >= 0 AND ${table.provider_cost_microusd} >= 0 AND ${table.charged_microusd} >= 0`,
    ),
  ],
);

export const billingLedgerEntries = pgTable(
  "billing_ledger_entries",
  {
    id: text("id").primaryKey(),
    account_id: text("account_id")
      .notNull()
      .references(() => billingAccounts.id, { onDelete: "restrict" }),
    platform_user_id: text("platform_user_id")
      .notNull()
      .references(() => platformUsers.id, { onDelete: "restrict" }),
    gateway_request_id: text("gateway_request_id").references(
      () => gatewayRequests.id,
      { onDelete: "restrict" },
    ),
    entry_type: text("entry_type").notNull(),
    amount_microusd: bigint("amount_microusd", { mode: "number" }).notNull(),
    available_before_microusd: bigint("available_before_microusd", {
      mode: "number",
    }).notNull(),
    available_after_microusd: bigint("available_after_microusd", {
      mode: "number",
    }).notNull(),
    reserved_before_microusd: bigint("reserved_before_microusd", {
      mode: "number",
    }).notNull(),
    reserved_after_microusd: bigint("reserved_after_microusd", {
      mode: "number",
    }).notNull(),
    idempotency_key: text("idempotency_key").notNull(),
    description: text("description"),
    actor_type: text("actor_type").notNull(),
    actor_id: text("actor_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("billing_ledger_entries_idempotency_uidx").on(
      table.idempotency_key,
    ),
    index("billing_ledger_entries_account_created_idx").on(
      table.account_id,
      table.created_at,
    ),
    index("billing_ledger_entries_request_idx").on(table.gateway_request_id),
    check(
      "billing_ledger_entries_amount_check",
      sql`${table.amount_microusd} > 0`,
    ),
    check(
      "billing_ledger_entries_reserved_after_check",
      sql`${table.reserved_after_microusd} >= 0`,
    ),
  ],
);

export const gatewayRateLimits = pgTable(
  "gateway_rate_limits",
  {
    platform_user_id: text("platform_user_id")
      .notNull()
      .references(() => platformUsers.id, { onDelete: "cascade" }),
    model_id: text("model_id")
      .notNull()
      .references(() => aiModels.id, { onDelete: "cascade" }),
    window_type: text("window_type").notNull(),
    window_start: timestamp("window_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    request_count: integer("request_count").notNull().default(0),
    token_count: bigint("token_count", { mode: "number" }).notNull().default(0),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "gateway_rate_limits_pk",
      columns: [
        table.platform_user_id,
        table.model_id,
        table.window_type,
        table.window_start,
      ],
    }),
    check(
      "gateway_rate_limits_request_count_check",
      sql`${table.request_count} >= 0`,
    ),
    check(
      "gateway_rate_limits_token_count_check",
      sql`${table.token_count} >= 0`,
    ),
  ],
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    display_name: text("display_name"),
    password_hash: text("password_hash").notNull(),
    status: text("status").notNull().default("active"),
    last_login_at: timestamp("last_login_at", {
      withTimezone: true,
      mode: "date",
    }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("admin_users_email_uidx").on(table.email)],
);

export const adminRoles = pgTable(
  "admin_roles",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("admin_roles_code_uidx").on(table.code)],
);

export const adminPermissions = pgTable(
  "admin_permissions",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("admin_permissions_code_uidx").on(table.code)],
);

export const adminUserRoles = pgTable(
  "admin_user_roles",
  {
    admin_user_id: text("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    role_id: text("role_id")
      .notNull()
      .references(() => adminRoles.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "admin_user_roles_pk",
      columns: [table.admin_user_id, table.role_id],
    }),
  ],
);

export const adminRolePermissions = pgTable(
  "admin_role_permissions",
  {
    role_id: text("role_id")
      .notNull()
      .references(() => adminRoles.id, { onDelete: "cascade" }),
    permission_id: text("permission_id")
      .notNull()
      .references(() => adminPermissions.id, { onDelete: "cascade" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "admin_role_permissions_pk",
      columns: [table.role_id, table.permission_id],
    }),
  ],
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: text("id").primaryKey(),
    admin_user_id: text("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "cascade" }),
    token_hash: text("token_hash").notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true, mode: "date" })
      .notNull(),
    last_seen_at: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    revoked_at: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("admin_sessions_token_hash_uidx").on(table.token_hash),
    index("admin_sessions_user_idx").on(table.admin_user_id),
    index("admin_sessions_expiry_idx").on(table.expires_at),
  ],
);

export const adminAuditLogs = pgTable(
  "admin_audit_logs",
  {
    id: text("id").primaryKey(),
    actor_type: text("actor_type").notNull(),
    actor_id: text("actor_id"),
    action: text("action").notNull(),
    resource_type: text("resource_type").notNull(),
    resource_id: text("resource_id"),
    request_id: text("request_id").notNull(),
    ip_address: text("ip_address"),
    user_agent: text("user_agent"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("admin_audit_logs_request_action_uidx").on(
      table.request_id,
      table.action,
      table.resource_type,
      table.resource_id,
    ),
    index("admin_audit_logs_created_idx").on(table.created_at),
    index("admin_audit_logs_resource_idx").on(
      table.resource_type,
      table.resource_id,
    ),
  ],
);
