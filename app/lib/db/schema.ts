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

/**
 * Canonical Story product identities and first-wave content tables.
 *
 * These tables live in the same PostgreSQL database as the Admin control
 * plane. Every canonical user is automatically provisioned into the internal
 * `platform_users` Billing/Gateway FK adapter; that adapter is not a second
 * product user resource. Deprecated parallel `story_*` tables remain retained
 * for a later controlled retirement.
 */
export const users = pgTable(
  "users",
  {
    id: bigint("id", { mode: "number" })
      .primaryKey()
      .generatedByDefaultAsIdentity(),
    email: text("email").notNull(),
    password_hash: text("password_hash").notNull(),
    display_name: text("display_name"),
    avatar_url: text("avatar_url"),
    role: text("role").notNull().default("user"),
    /** @deprecated Admin-only compatibility column from migration 0011. */
    admin_deprecated_status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_uidx").on(table.email),
    index("users_status_updated_idx").on(
      table.admin_deprecated_status,
      table.updated_at,
    ),
    check(
      "users_status_check",
      sql`${table.admin_deprecated_status} IN ('active', 'disabled')`,
    ),
  ],
);

export const storyWorkspaceWorkspaces = pgTable(
  "story_workspace_workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    owner_id: bigint("owner_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // Migration 0011 stores the source JSON-text value as lossless jsonb.
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    /** @deprecated Admin-only compatibility column from migration 0011. */
    admin_deprecated_status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("story_workspace_workspaces_owner_idx").on(table.owner_id),
    index("story_workspace_workspaces_status_updated_idx").on(
      table.admin_deprecated_status,
      table.updated_at,
    ),
    check(
      "story_workspace_workspaces_status_check",
      sql`${table.admin_deprecated_status} IN ('active', 'archived')`,
    ),
  ],
);

export const storyWorkspaceStories = pgTable(
  "story_workspace_stories",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("draft"),
    review_status: text("review_status").notNull().default("pending"),
    type: text("type").notNull().default("short"),
    content: text("content"),
    author_id: bigint("author_id", { mode: "number" })
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    workspace_id: text("workspace_id")
      .notNull()
      .references(() => storyWorkspaceWorkspaces.id, { onDelete: "restrict" }),
    character_count: integer("character_count").notNull().default(0),
    scene_count: integer("scene_count").notNull().default(0),
    agent_generated: integer("agent_generated").notNull().default(1),
    agent_session_id: text("agent_session_id"),
    review_notes: text("review_notes"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    confirmed_at: timestamp("confirmed_at", {
      withTimezone: true,
      mode: "date",
    }),
    published_at: timestamp("published_at", {
      withTimezone: true,
      mode: "date",
    }),
  },
  (table) => [
    index("story_workspace_stories_author_updated_idx").on(
      table.author_id,
      table.updated_at,
    ),
    index("story_workspace_stories_workspace_updated_idx").on(
      table.workspace_id,
      table.updated_at,
    ),
    index("story_workspace_stories_status_updated_idx").on(
      table.status,
      table.updated_at,
    ),
    index("story_workspace_stories_review_updated_idx").on(
      table.review_status,
      table.updated_at,
    ),
    index("story_workspace_stories_type_updated_idx").on(
      table.type,
      table.updated_at,
    ),
    index("story_workspace_stories_title_idx").on(table.title),
    check(
      "story_workspace_stories_status_check",
      sql`${table.status} IN ('draft', 'published', 'archived')`,
    ),
    check(
      "story_workspace_stories_review_status_check",
      sql`${table.review_status} IN ('pending', 'confirmed', 'rejected')`,
    ),
    check(
      "story_workspace_stories_type_check",
      sql`${table.type} IN ('short', 'long', 'script', 'outline')`,
    ),
    check(
      "story_workspace_stories_agent_generated_check",
      sql`${table.agent_generated} IN (0, 1)`,
    ),
    check(
      "story_workspace_stories_character_count_check",
      sql`${table.character_count} >= 0`,
    ),
    check(
      "story_workspace_stories_scene_count_check",
      sql`${table.scene_count} >= 0`,
    ),
  ],
);

export const systemSettings = pgTable(
  "system_settings",
  {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<Record<string, unknown>>().notNull().default({}),
    description: text("description"),
    is_secret: boolean("is_secret").notNull().default(false),
    status: text("status").notNull().default("active"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("system_settings_category_key_uidx").on(
      table.category,
      table.key,
    ),
    index("system_settings_status_idx").on(table.status),
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
    source: text("source").notNull().default("manual"),
    source_ref: text("source_ref"),
    source_version: text("source_version"),
    source_metadata: jsonb("source_metadata")
      .$type<Record<string, unknown>>()
      .default({}),
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

export const aiProviderDiscoverySnapshots = pgTable(
  "ai_provider_discovery_snapshots",
  {
    id: text("id").primaryKey(),
    provider_id: text("provider_id")
      .notNull()
      .references(() => aiProviders.id, { onDelete: "restrict" }),
    provider_updated_at: timestamp("provider_updated_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    status: text("status").notNull().default("ready"),
    endpoint: text("endpoint").notNull(),
    catalog_hash: text("catalog_hash").notNull(),
    models: jsonb("models").$type<Array<Record<string, unknown>>>().notNull(),
    diff: jsonb("diff").$type<Array<Record<string, unknown>>>().notNull(),
    created_by: text("created_by").notNull(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    applied_at: timestamp("applied_at", {
      withTimezone: true,
      mode: "date",
    }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_provider_discovery_provider_idx").on(
      table.provider_id,
      table.created_at,
    ),
    index("ai_provider_discovery_expiry_idx").on(table.expires_at),
    check(
      "ai_provider_discovery_status_check",
      sql`${table.status} IN ('ready', 'applied', 'expired')`,
    ),
  ],
);

export const aiPricingSyncSnapshots = pgTable(
  "ai_pricing_sync_snapshots",
  {
    id: text("id").primaryKey(),
    provider_id: text("provider_id").references(() => aiProviders.id, {
      onDelete: "restrict",
    }),
    catalog_ref: text("catalog_ref").notNull(),
    catalog_version: text("catalog_version").notNull(),
    catalog_hash: text("catalog_hash").notNull(),
    status: text("status").notNull().default("ready"),
    matches: jsonb("matches")
      .$type<Array<Record<string, unknown>>>()
      .notNull(),
    created_by: text("created_by").notNull(),
    expires_at: timestamp("expires_at", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    applied_at: timestamp("applied_at", {
      withTimezone: true,
      mode: "date",
    }),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("ai_pricing_sync_provider_idx").on(
      table.provider_id,
      table.created_at,
    ),
    index("ai_pricing_sync_expiry_idx").on(table.expires_at),
    check(
      "ai_pricing_sync_status_check",
      sql`${table.status} IN ('ready', 'applied', 'expired')`,
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

export const subscriptionPlans = pgTable(
  "subscription_plans",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    currency: text("currency").notNull().default("USD"),
    status: text("status").notNull().default("draft"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("subscription_plans_code_uidx").on(table.code),
    index("subscription_plans_status_updated_idx").on(
      table.status,
      table.updated_at,
    ),
    check(
      "subscription_plans_status_check",
      sql`${table.status} IN ('draft', 'active', 'retired')`,
    ),
    check("subscription_plans_currency_check", sql`${table.currency} = 'USD'`),
  ],
);

export const subscriptionPlanVersions = pgTable(
  "subscription_plan_versions",
  {
    id: text("id").primaryKey(),
    plan_id: text("plan_id")
      .notNull()
      .references(() => subscriptionPlans.id, { onDelete: "restrict" }),
    version_number: integer("version_number").notNull(),
    status: text("status").notNull().default("draft"),
    billing_period: text("billing_period").notNull().default("monthly"),
    base_price_microusd: bigint("base_price_microusd", { mode: "number" })
      .notNull()
      .default(0),
    trial_days: integer("trial_days").notNull().default(0),
    grace_period_days: integer("grace_period_days").notNull().default(0),
    allowance_tokens: bigint("allowance_tokens", { mode: "number" })
      .notNull()
      .default(0),
    allowance_microusd: bigint("allowance_microusd", { mode: "number" })
      .notNull()
      .default(0),
    overage_policy: text("overage_policy").notNull().default("deny"),
    effective_from: timestamp("effective_from", {
      withTimezone: true,
      mode: "date",
    }),
    published_at: timestamp("published_at", {
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
    uniqueIndex("subscription_plan_versions_plan_number_uidx").on(
      table.plan_id,
      table.version_number,
    ),
    index("subscription_plan_versions_status_effective_idx").on(
      table.status,
      table.effective_from,
    ),
    check(
      "subscription_plan_versions_status_check",
      sql`${table.status} IN ('draft', 'published', 'retired')`,
    ),
    check(
      "subscription_plan_versions_billing_period_check",
      sql`${table.billing_period} IN ('monthly', 'annual')`,
    ),
    check(
      "subscription_plan_versions_overage_check",
      sql`${table.overage_policy} IN ('deny', 'cash_balance')`,
    ),
    check(
      "subscription_plan_versions_values_check",
      sql`${table.version_number} > 0 AND ${table.base_price_microusd} >= 0 AND ${table.trial_days} >= 0 AND ${table.grace_period_days} >= 0 AND ${table.allowance_tokens} >= 0 AND ${table.allowance_microusd} >= 0`,
    ),
  ],
);

export const subscriptionPlanEntitlements = pgTable(
  "subscription_plan_entitlements",
  {
    id: text("id").primaryKey(),
    plan_version_id: text("plan_version_id")
      .notNull()
      .references(() => subscriptionPlanVersions.id, { onDelete: "cascade" }),
    model_id: text("model_id")
      .notNull()
      .references(() => aiModels.id, { onDelete: "restrict" }),
    gateway_scopes: text("gateway_scopes").array().notNull(),
    requests_per_minute: integer("requests_per_minute"),
    daily_token_limit: bigint("daily_token_limit", { mode: "number" }),
    monthly_token_limit: bigint("monthly_token_limit", { mode: "number" }),
    storage_bytes_limit: bigint("storage_bytes_limit", { mode: "number" }),
    enabled: boolean("enabled").notNull().default(true),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("subscription_entitlements_version_model_uidx").on(
      table.plan_version_id,
      table.model_id,
    ),
    index("subscription_entitlements_model_idx").on(table.model_id),
    check(
      "subscription_entitlements_rpm_check",
      sql`${table.requests_per_minute} IS NULL OR ${table.requests_per_minute} > 0`,
    ),
    check(
      "subscription_entitlements_limits_check",
      sql`(${table.daily_token_limit} IS NULL OR ${table.daily_token_limit} >= 0) AND (${table.monthly_token_limit} IS NULL OR ${table.monthly_token_limit} >= 0) AND (${table.storage_bytes_limit} IS NULL OR ${table.storage_bytes_limit} >= 0)`,
    ),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    platform_user_id: text("platform_user_id")
      .notNull()
      .references(() => platformUsers.id, { onDelete: "restrict" }),
    plan_version_id: text("plan_version_id")
      .notNull()
      .references(() => subscriptionPlanVersions.id, { onDelete: "restrict" }),
    pending_plan_version_id: text("pending_plan_version_id").references(
      () => subscriptionPlanVersions.id,
      { onDelete: "restrict" },
    ),
    status: text("status").notNull(),
    current_period_start: timestamp("current_period_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    current_period_end: timestamp("current_period_end", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    trial_ends_at: timestamp("trial_ends_at", {
      withTimezone: true,
      mode: "date",
    }),
    grace_ends_at: timestamp("grace_ends_at", {
      withTimezone: true,
      mode: "date",
    }),
    renewal_enabled: boolean("renewal_enabled").notNull().default(true),
    paused_at: timestamp("paused_at", { withTimezone: true, mode: "date" }),
    cancelled_at: timestamp("cancelled_at", {
      withTimezone: true,
      mode: "date",
    }),
    version: integer("version").notNull().default(1),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("subscriptions_user_status_idx").on(
      table.platform_user_id,
      table.status,
    ),
    index("subscriptions_period_end_idx").on(table.current_period_end),
    check(
      "subscriptions_status_check",
      sql`${table.status} IN ('trial', 'active', 'past_due', 'paused', 'cancel_at_period_end', 'cancelled', 'expired')`,
    ),
    check(
      "subscriptions_period_check",
      sql`${table.current_period_end} > ${table.current_period_start}`,
    ),
    check("subscriptions_version_check", sql`${table.version} > 0`),
  ],
);

export const subscriptionUsageAllowances = pgTable(
  "subscription_usage_allowances",
  {
    id: text("id").primaryKey(),
    subscription_id: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    period_start: timestamp("period_start", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    period_end: timestamp("period_end", {
      withTimezone: true,
      mode: "date",
    }).notNull(),
    granted_tokens: bigint("granted_tokens", { mode: "number" })
      .notNull()
      .default(0),
    reserved_tokens: bigint("reserved_tokens", { mode: "number" })
      .notNull()
      .default(0),
    consumed_tokens: bigint("consumed_tokens", { mode: "number" })
      .notNull()
      .default(0),
    granted_microusd: bigint("granted_microusd", { mode: "number" })
      .notNull()
      .default(0),
    reserved_microusd: bigint("reserved_microusd", { mode: "number" })
      .notNull()
      .default(0),
    consumed_microusd: bigint("consumed_microusd", { mode: "number" })
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
    uniqueIndex("subscription_allowances_period_uidx").on(
      table.subscription_id,
      table.period_start,
      table.period_end,
    ),
    index("subscription_allowances_period_end_idx").on(table.period_end),
    check(
      "subscription_allowances_period_check",
      sql`${table.period_end} > ${table.period_start}`,
    ),
    check(
      "subscription_allowances_balance_check",
      sql`${table.granted_tokens} >= 0 AND ${table.reserved_tokens} >= 0 AND ${table.consumed_tokens} >= 0 AND ${table.reserved_tokens} + ${table.consumed_tokens} <= ${table.granted_tokens} AND ${table.granted_microusd} >= 0 AND ${table.reserved_microusd} >= 0 AND ${table.consumed_microusd} >= 0 AND ${table.reserved_microusd} + ${table.consumed_microusd} <= ${table.granted_microusd}`,
    ),
  ],
);

export const subscriptionEvents = pgTable(
  "subscription_events",
  {
    id: text("id").primaryKey(),
    subscription_id: text("subscription_id")
      .notNull()
      .references(() => subscriptions.id, { onDelete: "restrict" }),
    event_type: text("event_type").notNull(),
    idempotency_key: text("idempotency_key").notNull(),
    actor_type: text("actor_type").notNull(),
    actor_id: text("actor_id"),
    reason: text("reason"),
    before: jsonb("before").$type<Record<string, unknown>>(),
    after: jsonb("after").$type<Record<string, unknown>>(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    created_at: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("subscription_events_idempotency_uidx").on(
      table.idempotency_key,
    ),
    index("subscription_events_subscription_created_idx").on(
      table.subscription_id,
      table.created_at,
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
    check(
      "user_model_permissions_rpm_check",
      sql`${table.requests_per_minute} IS NULL OR ${table.requests_per_minute} > 0`,
    ),
    check(
      "user_model_permissions_daily_tokens_check",
      sql`${table.daily_token_limit} IS NULL OR ${table.daily_token_limit} >= 0`,
    ),
    check(
      "user_model_permissions_monthly_tokens_check",
      sql`${table.monthly_token_limit} IS NULL OR ${table.monthly_token_limit} >= 0`,
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
    subscription_id: text("subscription_id").references(
      () => subscriptions.id,
      { onDelete: "restrict" },
    ),
    subscription_plan_version_id: text(
      "subscription_plan_version_id",
    ).references(() => subscriptionPlanVersions.id, { onDelete: "restrict" }),
    subscription_entitlement_id: text("subscription_entitlement_id").references(
      () => subscriptionPlanEntitlements.id,
      { onDelete: "restrict" },
    ),
    subscription_allowance_id: text("subscription_allowance_id").references(
      () => subscriptionUsageAllowances.id,
      { onDelete: "restrict" },
    ),
    subscription_snapshot: jsonb("subscription_snapshot").$type<
      Record<string, unknown>
    >(),
    protocol: text("protocol").notNull(),
    requested_model: text("requested_model").notNull(),
    resolved_model: text("resolved_model").notNull(),
    upstream_request_id: text("upstream_request_id"),
    status: text("status").notNull().default("received"),
    outcome: text("outcome").notNull().default("pending"),
    input_token_semantics: text("input_token_semantics").notNull(),
    estimated_tokens: bigint("estimated_tokens", { mode: "number" })
      .notNull()
      .default(0),
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
    allowance_reserved_microusd: bigint("allowance_reserved_microusd", {
      mode: "number",
    })
      .notNull()
      .default(0),
    allowance_charged_microusd: bigint("allowance_charged_microusd", {
      mode: "number",
    })
      .notNull()
      .default(0),
    allowance_reserved_tokens: bigint("allowance_reserved_tokens", {
      mode: "number",
    })
      .notNull()
      .default(0),
    allowance_charged_tokens: bigint("allowance_charged_tokens", {
      mode: "number",
    })
      .notNull()
      .default(0),
    subscription_coverage_mode: text("subscription_coverage_mode"),
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
    payload_capture_status: text("payload_capture_status").notNull().default("pending"),
    payload_capture_error: text("payload_capture_error"),
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
    index("gateway_requests_subscription_idx").on(
      table.subscription_id,
      table.created_at,
    ),
    check(
      "gateway_requests_estimated_tokens_check",
      sql`${table.estimated_tokens} >= 0`,
    ),
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
      sql`${table.reserved_microusd} >= 0 AND ${table.allowance_reserved_microusd} >= 0 AND ${table.allowance_charged_microusd} >= 0 AND ${table.provider_cost_microusd} >= 0 AND ${table.charged_microusd} >= 0`,
    ),
  ],
);

/**
 * Full application-layer gateway payloads are intentionally split from the
 * hot request index. They may contain user prompts and model output and must
 * only be read through the dedicated gateway.payloads.read permission.
 */
export const gatewayRequestPayloads = pgTable(
  "gateway_request_payloads",
  {
    gateway_request_id: text("gateway_request_id")
      .primaryKey()
      .references(() => gatewayRequests.id, { onDelete: "cascade" }),
    method: text("method").notNull(),
    path: text("path").notNull(),
    query: jsonb("query").$type<Record<string, string[]>>().notNull().default({}),
    protocol: text("protocol").notNull(),
    requested_model: text("requested_model").notNull(),
    provider_protocol: text("provider_protocol").notNull(),
    headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
    body_json: jsonb("body_json").$type<unknown>(),
    body_text: text("body_text").notNull(),
    content_type: text("content_type"),
    byte_length: bigint("byte_length", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    compression: text("compression").notNull().default("none"),
    completion_status: text("completion_status").notNull().default("complete"),
    capture_error: text("capture_error"),
    captured_at: timestamp("captured_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("gateway_request_payloads_captured_idx").on(table.captured_at),
    check("gateway_request_payloads_bytes_check", sql`${table.byte_length} >= 0`),
  ],
);

export const gatewayResponsePayloads = pgTable(
  "gateway_response_payloads",
  {
    gateway_request_id: text("gateway_request_id")
      .primaryKey()
      .references(() => gatewayRequests.id, { onDelete: "cascade" }),
    http_status: integer("http_status"),
    content_type: text("content_type"),
    headers: jsonb("headers").$type<Record<string, string>>().notNull().default({}),
    body_json: jsonb("body_json").$type<unknown>(),
    body_text: text("body_text"),
    byte_length: bigint("byte_length", { mode: "number" }).notNull().default(0),
    sha256: text("sha256"),
    compression: text("compression").notNull().default("none"),
    completion_status: text("completion_status").notNull().default("pending"),
    provider_request_id: text("provider_request_id"),
    error_body: jsonb("error_body").$type<unknown>(),
    capture_error: text("capture_error"),
    started_at: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    first_event_at: timestamp("first_event_at", { withTimezone: true, mode: "date" }),
    completed_at: timestamp("completed_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("gateway_response_payloads_completed_idx").on(table.completed_at),
    check("gateway_response_payloads_bytes_check", sql`${table.byte_length} >= 0`),
  ],
);

export const gatewayResponseEvents = pgTable(
  "gateway_response_events",
  {
    id: text("id").primaryKey(),
    gateway_request_id: text("gateway_request_id")
      .notNull()
      .references(() => gatewayRequests.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    event_type: text("event_type").notNull(),
    raw_data: text("raw_data").notNull(),
    raw_event: text("raw_event").notNull(),
    byte_length: bigint("byte_length", { mode: "number" }).notNull(),
    elapsed_ms: integer("elapsed_ms").notNull(),
    emitted_at: timestamp("emitted_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("gateway_response_events_request_sequence_uidx").on(
      table.gateway_request_id,
      table.sequence,
    ),
    index("gateway_response_events_request_idx").on(table.gateway_request_id),
    check("gateway_response_events_sequence_check", sql`${table.sequence} >= 0`),
    check("gateway_response_events_bytes_check", sql`${table.byte_length} >= 0`),
    check("gateway_response_events_elapsed_check", sql`${table.elapsed_ms} >= 0`),
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
    subscription_id: text("subscription_id").references(
      () => subscriptions.id,
      { onDelete: "restrict" },
    ),
    subscription_allowance_id: text("subscription_allowance_id").references(
      () => subscriptionUsageAllowances.id,
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
    index("billing_ledger_entries_subscription_idx").on(
      table.subscription_id,
      table.created_at,
    ),
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
