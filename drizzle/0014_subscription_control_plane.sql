CREATE TABLE "subscription_plans" (
  "id" text PRIMARY KEY NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "currency" text DEFAULT 'USD' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscription_plans_status_check" CHECK ("status" IN ('draft', 'active', 'retired')),
  CONSTRAINT "subscription_plans_currency_check" CHECK ("currency" = 'USD')
);
--> statement-breakpoint
CREATE TABLE "subscription_plan_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_id" text NOT NULL,
  "version_number" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "billing_period" text DEFAULT 'monthly' NOT NULL,
  "base_price_microusd" bigint DEFAULT 0 NOT NULL,
  "trial_days" integer DEFAULT 0 NOT NULL,
  "grace_period_days" integer DEFAULT 0 NOT NULL,
  "allowance_tokens" bigint DEFAULT 0 NOT NULL,
  "allowance_microusd" bigint DEFAULT 0 NOT NULL,
  "overage_policy" text DEFAULT 'deny' NOT NULL,
  "effective_from" timestamp with time zone,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscription_plan_versions_status_check" CHECK ("status" IN ('draft', 'published', 'retired')),
  CONSTRAINT "subscription_plan_versions_billing_period_check" CHECK ("billing_period" IN ('monthly', 'annual')),
  CONSTRAINT "subscription_plan_versions_overage_check" CHECK ("overage_policy" IN ('deny', 'cash_balance')),
  CONSTRAINT "subscription_plan_versions_values_check" CHECK (
    "version_number" > 0 AND "base_price_microusd" >= 0 AND
    "trial_days" >= 0 AND "grace_period_days" >= 0 AND
    "allowance_tokens" >= 0 AND "allowance_microusd" >= 0
  )
);
--> statement-breakpoint
CREATE TABLE "subscription_plan_entitlements" (
  "id" text PRIMARY KEY NOT NULL,
  "plan_version_id" text NOT NULL,
  "model_id" text NOT NULL,
  "gateway_scopes" text[] NOT NULL,
  "requests_per_minute" integer,
  "daily_token_limit" bigint,
  "monthly_token_limit" bigint,
  "storage_bytes_limit" bigint,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscription_entitlements_rpm_check" CHECK ("requests_per_minute" IS NULL OR "requests_per_minute" > 0),
  CONSTRAINT "subscription_entitlements_limits_check" CHECK (
    ("daily_token_limit" IS NULL OR "daily_token_limit" >= 0) AND
    ("monthly_token_limit" IS NULL OR "monthly_token_limit" >= 0) AND
    ("storage_bytes_limit" IS NULL OR "storage_bytes_limit" >= 0)
  )
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
  "id" text PRIMARY KEY NOT NULL,
  "platform_user_id" text NOT NULL,
  "plan_version_id" text NOT NULL,
  "pending_plan_version_id" text,
  "status" text NOT NULL,
  "current_period_start" timestamp with time zone NOT NULL,
  "current_period_end" timestamp with time zone NOT NULL,
  "trial_ends_at" timestamp with time zone,
  "grace_ends_at" timestamp with time zone,
  "renewal_enabled" boolean DEFAULT true NOT NULL,
  "paused_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscriptions_status_check" CHECK ("status" IN ('trial', 'active', 'past_due', 'paused', 'cancel_at_period_end', 'cancelled', 'expired')),
  CONSTRAINT "subscriptions_period_check" CHECK ("current_period_end" > "current_period_start"),
  CONSTRAINT "subscriptions_version_check" CHECK ("version" > 0)
);
--> statement-breakpoint
CREATE TABLE "subscription_usage_allowances" (
  "id" text PRIMARY KEY NOT NULL,
  "subscription_id" text NOT NULL,
  "period_start" timestamp with time zone NOT NULL,
  "period_end" timestamp with time zone NOT NULL,
  "granted_tokens" bigint DEFAULT 0 NOT NULL,
  "reserved_tokens" bigint DEFAULT 0 NOT NULL,
  "consumed_tokens" bigint DEFAULT 0 NOT NULL,
  "granted_microusd" bigint DEFAULT 0 NOT NULL,
  "reserved_microusd" bigint DEFAULT 0 NOT NULL,
  "consumed_microusd" bigint DEFAULT 0 NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscription_allowances_period_check" CHECK ("period_end" > "period_start"),
  CONSTRAINT "subscription_allowances_balance_check" CHECK (
    "granted_tokens" >= 0 AND "reserved_tokens" >= 0 AND "consumed_tokens" >= 0 AND
    "reserved_tokens" + "consumed_tokens" <= "granted_tokens" AND
    "granted_microusd" >= 0 AND "reserved_microusd" >= 0 AND "consumed_microusd" >= 0 AND
    "reserved_microusd" + "consumed_microusd" <= "granted_microusd"
  )
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
  "id" text PRIMARY KEY NOT NULL,
  "subscription_id" text NOT NULL,
  "event_type" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "reason" text,
  "before" jsonb,
  "after" jsonb,
  "metadata" jsonb DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscription_plan_versions" ADD CONSTRAINT "subscription_plan_versions_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."subscription_plans"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscription_plan_entitlements" ADD CONSTRAINT "subscription_entitlements_version_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."subscription_plan_versions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscription_plan_entitlements" ADD CONSTRAINT "subscription_entitlements_model_fk" FOREIGN KEY ("model_id") REFERENCES "public"."ai_models"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_version_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."subscription_plan_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_version_fk" FOREIGN KEY ("pending_plan_version_id") REFERENCES "public"."subscription_plan_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscription_usage_allowances" ADD CONSTRAINT "subscription_allowances_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plans_code_uidx" ON "subscription_plans" ("code");
--> statement-breakpoint
CREATE INDEX "subscription_plans_status_updated_idx" ON "subscription_plans" ("status", "updated_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_plan_versions_plan_number_uidx" ON "subscription_plan_versions" ("plan_id", "version_number");
--> statement-breakpoint
CREATE INDEX "subscription_plan_versions_status_effective_idx" ON "subscription_plan_versions" ("status", "effective_from");
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_entitlements_version_model_uidx" ON "subscription_plan_entitlements" ("plan_version_id", "model_id");
--> statement-breakpoint
CREATE INDEX "subscription_entitlements_model_idx" ON "subscription_plan_entitlements" ("model_id");
--> statement-breakpoint
CREATE INDEX "subscriptions_user_status_idx" ON "subscriptions" ("platform_user_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_callable_user_uidx" ON "subscriptions" ("platform_user_id") WHERE "status" IN ('trial', 'active', 'past_due', 'paused', 'cancel_at_period_end');
--> statement-breakpoint
CREATE INDEX "subscriptions_period_end_idx" ON "subscriptions" ("current_period_end");
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_allowances_period_uidx" ON "subscription_usage_allowances" ("subscription_id", "period_start", "period_end");
--> statement-breakpoint
CREATE INDEX "subscription_allowances_period_end_idx" ON "subscription_usage_allowances" ("period_end");
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_events_idempotency_uidx" ON "subscription_events" ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "subscription_events_subscription_created_idx" ON "subscription_events" ("subscription_id", "created_at");
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "subscription_id" text;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "subscription_plan_version_id" text;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "subscription_entitlement_id" text;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "subscription_allowance_id" text;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "subscription_snapshot" jsonb;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "allowance_reserved_microusd" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "allowance_charged_microusd" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "allowance_reserved_tokens" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "allowance_charged_tokens" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "subscription_coverage_mode" text;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_subscription_version_fk" FOREIGN KEY ("subscription_plan_version_id") REFERENCES "public"."subscription_plan_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_entitlement_fk" FOREIGN KEY ("subscription_entitlement_id") REFERENCES "public"."subscription_plan_entitlements"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_allowance_fk" FOREIGN KEY ("subscription_allowance_id") REFERENCES "public"."subscription_usage_allowances"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_allowance_money_check" CHECK ("allowance_reserved_microusd" >= 0 AND "allowance_charged_microusd" >= 0 AND "allowance_reserved_tokens" >= 0 AND "allowance_charged_tokens" >= 0 AND ("subscription_coverage_mode" IS NULL OR "subscription_coverage_mode" IN ('token_allowance', 'money_allowance', 'cash_only')));
--> statement-breakpoint
CREATE INDEX "gateway_requests_subscription_idx" ON "gateway_requests" ("subscription_id", "created_at");
--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD COLUMN "subscription_id" text;
--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD COLUMN "subscription_allowance_id" text;
--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "billing_ledger_entries" ADD CONSTRAINT "billing_ledger_allowance_fk" FOREIGN KEY ("subscription_allowance_id") REFERENCES "public"."subscription_usage_allowances"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "billing_ledger_entries_subscription_idx" ON "billing_ledger_entries" ("subscription_id", "created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_published_plan_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'published' THEN
    RAISE EXCEPTION 'published subscription plan versions are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_plan_versions_no_published_update BEFORE UPDATE OR DELETE ON "subscription_plan_versions" FOR EACH ROW EXECUTE FUNCTION prevent_published_plan_version_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_published_entitlement_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_version_id text;
DECLARE target_status text;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_version_id ELSE NEW.plan_version_id END;
  SELECT status INTO target_status FROM subscription_plan_versions WHERE id = target_version_id;
  IF target_status = 'published' THEN
    RAISE EXCEPTION 'published subscription entitlements are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_entitlements_no_published_mutation BEFORE INSERT OR UPDATE OR DELETE ON "subscription_plan_entitlements" FOR EACH ROW EXECUTE FUNCTION prevent_published_entitlement_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_subscription_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'subscription_events is append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_events_no_update BEFORE UPDATE ON "subscription_events" FOR EACH ROW EXECUTE FUNCTION prevent_subscription_event_mutation();
--> statement-breakpoint
CREATE TRIGGER subscription_events_no_delete BEFORE DELETE ON "subscription_events" FOR EACH ROW EXECUTE FUNCTION prevent_subscription_event_mutation();
--> statement-breakpoint
COMMENT ON COLUMN "users"."status" IS 'DEPRECATED Admin-only compatibility field from migration 0011; not part of the Dream canonical contract and not used by Admin resources.';
--> statement-breakpoint
COMMENT ON COLUMN "story_workspace_workspaces"."status" IS 'DEPRECATED Admin-only compatibility field from migration 0011; not part of the Dream canonical contract and not used by Admin resources.';
--> statement-breakpoint
INSERT INTO "admin_permissions" ("id", "code", "name", "description") VALUES
  ('permission_subscriptions_read', 'subscriptions.read', 'Read subscriptions', 'Read plans, immutable versions, entitlements, subscriptions and allowances'),
  ('permission_subscriptions_write', 'subscriptions.write', 'Manage subscriptions', 'Create plans and drafts, publish versions, and execute audited subscription lifecycle commands')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name", "description" = EXCLUDED."description";
--> statement-breakpoint
INSERT INTO "admin_role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "admin_roles" r CROSS JOIN "admin_permissions" p
WHERE r."code" IN ('super_admin', 'operator') AND p."code" IN ('subscriptions.read', 'subscriptions.write')
ON CONFLICT DO NOTHING;
--> statement-breakpoint
INSERT INTO "admin_role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "admin_roles" r CROSS JOIN "admin_permissions" p
WHERE r."code" = 'auditor' AND p."code" = 'subscriptions.read'
ON CONFLICT DO NOTHING;
