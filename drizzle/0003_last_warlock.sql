CREATE TABLE "admin_audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"request_id" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"before" jsonb,
	"after" jsonb,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_role_permissions" (
	"role_id" text NOT NULL,
	"permission_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_role_permissions_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "admin_roles" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_user_roles" (
	"admin_user_id" text NOT NULL,
	"role_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_roles_pk" PRIMARY KEY("admin_user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"password_hash" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_models" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"code" text NOT NULL,
	"upstream_model" text NOT NULL,
	"display_name" text NOT NULL,
	"context_window" integer,
	"max_output_tokens" integer,
	"capabilities" jsonb DEFAULT '{}'::jsonb,
	"enabled" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_pricing_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"model_id" text NOT NULL,
	"user_tier" text DEFAULT 'default' NOT NULL,
	"input_price_microusd_per_million" bigint NOT NULL,
	"output_price_microusd_per_million" bigint NOT NULL,
	"cache_read_price_microusd_per_million" bigint DEFAULT 0 NOT NULL,
	"cache_write_price_microusd_per_million" bigint DEFAULT 0 NOT NULL,
	"markup_bps" integer DEFAULT 0 NOT NULL,
	"discount_bps" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"protocol" text NOT NULL,
	"base_url" text NOT NULL,
	"api_key_ciphertext" text,
	"api_key_iv" text,
	"api_key_tag" text,
	"api_key_fingerprint" text,
	"status" text DEFAULT 'disabled' NOT NULL,
	"timeout_ms" integer DEFAULT 120000 NOT NULL,
	"max_retries" integer DEFAULT 1 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_user_id" text NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"available_microusd" bigint DEFAULT 0 NOT NULL,
	"reserved_microusd" bigint DEFAULT 0 NOT NULL,
	"lifetime_debited_microusd" bigint DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"platform_user_id" text NOT NULL,
	"gateway_request_id" text,
	"entry_type" text NOT NULL,
	"amount_microusd" bigint NOT NULL,
	"available_before_microusd" bigint NOT NULL,
	"available_after_microusd" bigint NOT NULL,
	"reserved_before_microusd" bigint NOT NULL,
	"reserved_after_microusd" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"description" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gateway_rate_limits" (
	"platform_user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"window_type" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"token_count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gateway_rate_limits_pk" PRIMARY KEY("platform_user_id","model_id","window_type","window_start")
);
--> statement-breakpoint
CREATE TABLE "gateway_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"idempotency_key" text,
	"platform_user_id" text NOT NULL,
	"gateway_api_key_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_id" text NOT NULL,
	"pricing_rule_id" text NOT NULL,
	"protocol" text NOT NULL,
	"requested_model" text NOT NULL,
	"resolved_model" text NOT NULL,
	"upstream_request_id" text,
	"status" text DEFAULT 'received' NOT NULL,
	"input_token_semantics" text NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_read_tokens" bigint DEFAULT 0 NOT NULL,
	"cache_write_tokens" bigint DEFAULT 0 NOT NULL,
	"input_price_snapshot" bigint NOT NULL,
	"output_price_snapshot" bigint NOT NULL,
	"cache_read_price_snapshot" bigint DEFAULT 0 NOT NULL,
	"cache_write_price_snapshot" bigint DEFAULT 0 NOT NULL,
	"markup_bps_snapshot" integer DEFAULT 0 NOT NULL,
	"discount_bps_snapshot" integer DEFAULT 0 NOT NULL,
	"reserved_microusd" bigint DEFAULT 0 NOT NULL,
	"provider_cost_microusd" bigint DEFAULT 0 NOT NULL,
	"charged_microusd" bigint DEFAULT 0 NOT NULL,
	"is_streaming" boolean DEFAULT false NOT NULL,
	"http_status" integer,
	"error_code" text,
	"error_message" text,
	"first_token_ms" integer,
	"latency_ms" integer,
	"response_summary" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"settled_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "platform_users" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_user_id" text NOT NULL,
	"email" text,
	"display_name" text,
	"tier" text DEFAULT 'free' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"daily_token_limit" bigint,
	"monthly_token_limit" bigint,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_model_permissions" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_user_id" text NOT NULL,
	"model_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"requests_per_minute" integer,
	"daily_token_limit" bigint,
	"monthly_token_limit" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_role_permissions" ADD CONSTRAINT "admin_role_permissions_role_id_admin_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_permissions" ADD CONSTRAINT "admin_role_permissions_permission_id_admin_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."admin_permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_admin_user_id_admin_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_user_roles" ADD CONSTRAINT "admin_user_roles_role_id_admin_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."admin_roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_models" ADD CONSTRAINT "ai_models_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_pricing_rules" ADD CONSTRAINT "ai_pricing_rules_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_accounts" ADD CONSTRAINT "billing_accounts_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_account_id_billing_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."billing_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_entries_gateway_request_id_gateway_requests_id_fk" FOREIGN KEY ("gateway_request_id") REFERENCES "public"."gateway_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_api_keys" ADD CONSTRAINT "gateway_api_keys_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_rate_limits" ADD CONSTRAINT "gateway_rate_limits_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_rate_limits" ADD CONSTRAINT "gateway_rate_limits_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_gateway_api_key_id_gateway_api_keys_id_fk" FOREIGN KEY ("gateway_api_key_id") REFERENCES "public"."gateway_api_keys"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_provider_id_ai_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."ai_providers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_pricing_rule_id_ai_pricing_rules_id_fk" FOREIGN KEY ("pricing_rule_id") REFERENCES "public"."ai_pricing_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_model_permissions" ADD CONSTRAINT "user_model_permissions_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_model_permissions" ADD CONSTRAINT "user_model_permissions_model_id_ai_models_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_audit_logs_request_action_uidx" ON "admin_audit_logs" USING btree ("request_id","action","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_created_idx" ON "admin_audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "admin_audit_logs_resource_idx" ON "admin_audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_permissions_code_uidx" ON "admin_permissions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_roles_code_uidx" ON "admin_roles" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_sessions_token_hash_uidx" ON "admin_sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "admin_sessions_user_idx" ON "admin_sessions" USING btree ("admin_user_id");--> statement-breakpoint
CREATE INDEX "admin_sessions_expiry_idx" ON "admin_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "admin_users_email_uidx" ON "admin_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_models_code_uidx" ON "ai_models" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_models_provider_upstream_uidx" ON "ai_models" USING btree ("provider_id","upstream_model");--> statement-breakpoint
CREATE INDEX "ai_models_provider_idx" ON "ai_models" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "ai_models_enabled_idx" ON "ai_models" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "ai_pricing_rules_lookup_idx" ON "ai_pricing_rules" USING btree ("model_id","user_tier","status","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_providers_code_uidx" ON "ai_providers" USING btree ("code");--> statement-breakpoint
CREATE INDEX "ai_providers_status_idx" ON "ai_providers" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_accounts_user_uidx" ON "billing_accounts" USING btree ("platform_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_ledger_entries_idempotency_uidx" ON "billing_ledger_entries" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "billing_ledger_entries_account_created_idx" ON "billing_ledger_entries" USING btree ("account_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_ledger_entries_request_idx" ON "billing_ledger_entries" USING btree ("gateway_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_api_keys_hash_uidx" ON "gateway_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "gateway_api_keys_user_idx" ON "gateway_api_keys" USING btree ("platform_user_id");--> statement-breakpoint
CREATE INDEX "gateway_api_keys_prefix_idx" ON "gateway_api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_requests_user_idempotency_uidx" ON "gateway_requests" USING btree ("platform_user_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "gateway_requests_created_idx" ON "gateway_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "gateway_requests_user_created_idx" ON "gateway_requests" USING btree ("platform_user_id","created_at");--> statement-breakpoint
CREATE INDEX "gateway_requests_status_idx" ON "gateway_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "gateway_requests_upstream_idx" ON "gateway_requests" USING btree ("upstream_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "platform_users_source_external_uidx" ON "platform_users" USING btree ("source","external_user_id");--> statement-breakpoint
CREATE INDEX "platform_users_status_idx" ON "platform_users" USING btree ("status");--> statement-breakpoint
CREATE INDEX "platform_users_email_idx" ON "platform_users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "user_model_permissions_user_model_uidx" ON "user_model_permissions" USING btree ("platform_user_id","model_id");