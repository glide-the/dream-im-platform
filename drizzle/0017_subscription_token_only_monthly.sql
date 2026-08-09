ALTER TABLE "subscriptions" ADD COLUMN "cycle_anchor_at" timestamp with time zone;
--> statement-breakpoint
UPDATE "subscriptions"
SET "cycle_anchor_at" = "current_period_start"
WHERE "cycle_anchor_at" IS NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "cycle_anchor_at" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "current_period_number" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_period_number_check" CHECK ("current_period_number" >= 0);
--> statement-breakpoint
ALTER TABLE "subscription_usage_allowances" ADD COLUMN "plan_version_id" text;
--> statement-breakpoint
ALTER TABLE "subscription_usage_allowances" ADD COLUMN "period_number" integer;
--> statement-breakpoint
ALTER TABLE "subscription_usage_allowances" ADD CONSTRAINT "subscription_allowances_plan_version_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."subscription_plan_versions"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "subscription_usage_allowances" ADD CONSTRAINT "subscription_allowances_period_number_check" CHECK ("period_number" IS NULL OR "period_number" >= 0);
--> statement-breakpoint
UPDATE "subscription_usage_allowances" AS allowance
SET "plan_version_id" = subscription."plan_version_id",
    "period_number" = subscription."current_period_number"
FROM "subscriptions" AS subscription
WHERE allowance."subscription_id" = subscription."id"
  AND allowance."period_start" = subscription."current_period_start"
  AND allowance."period_end" = subscription."current_period_end";
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_allowances_cycle_period_uidx"
ON "subscription_usage_allowances" ("subscription_id", "period_number")
WHERE "period_number" IS NOT NULL;
--> statement-breakpoint
UPDATE "subscription_plan_versions"
SET "billing_period" = 'monthly',
    "base_price_microusd" = 0,
    "allowance_microusd" = 0,
    "overage_policy" = 'deny',
    "effective_from" = NULL,
    "updated_at" = NOW()
WHERE "status" = 'draft'
  AND (
    "billing_period" IS DISTINCT FROM 'monthly'
    OR "base_price_microusd" IS DISTINCT FROM 0
    OR "allowance_microusd" IS DISTINCT FROM 0
    OR "overage_policy" IS DISTINCT FROM 'deny'
    OR "effective_from" IS NOT NULL
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_published_plan_version_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'non-draft subscription plan versions are immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_plan_versions_immutable_check';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_published_entitlement_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_version_id text;
  target_status text;
  source_status text;
BEGIN
  target_version_id := CASE WHEN TG_OP = 'DELETE'
    THEN OLD.plan_version_id ELSE NEW.plan_version_id END;
  SELECT status INTO target_status
  FROM subscription_plan_versions
  WHERE id = target_version_id;
  IF TG_OP = 'UPDATE' THEN
    SELECT status INTO source_status
    FROM subscription_plan_versions
    WHERE id = OLD.plan_version_id;
  END IF;
  IF target_status IS DISTINCT FROM 'draft'
     OR (TG_OP = 'UPDATE' AND source_status IS DISTINCT FROM 'draft') THEN
    RAISE EXCEPTION 'non-draft subscription entitlements are immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_entitlements_immutable_check';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_token_only_subscription_plan_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.billing_period IS DISTINCT FROM 'monthly'
     OR NEW.base_price_microusd IS DISTINCT FROM 0
     OR NEW.allowance_microusd IS DISTINCT FROM 0
     OR NEW.overage_policy IS DISTINCT FROM 'deny'
     OR NEW.effective_from IS NOT NULL THEN
    RAISE EXCEPTION 'subscription plan versions are monthly token allowances only'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_plan_versions_token_only_check';
  END IF;

  IF NEW.status = 'published' AND NEW.allowance_tokens <= 0 THEN
    RAISE EXCEPTION 'published subscription plan versions require a positive token allowance'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_plan_versions_published_tokens_check';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_plan_versions_token_only
BEFORE INSERT OR UPDATE ON "subscription_plan_versions"
FOR EACH ROW
EXECUTE FUNCTION enforce_token_only_subscription_plan_version();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_traceable_token_only_allowance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     AND (NEW.plan_version_id IS NULL OR NEW.period_number IS NULL) THEN
    RAISE EXCEPTION 'new subscription allowances require plan version and period provenance'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_allowances_provenance_check';
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.plan_version_id IS NOT NULL
     AND (
       NEW.plan_version_id IS DISTINCT FROM OLD.plan_version_id
       OR NEW.period_number IS DISTINCT FROM OLD.period_number
     ) THEN
    RAISE EXCEPTION 'subscription allowance provenance is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_allowances_provenance_immutable_check';
  END IF;

  IF (TG_OP = 'INSERT'
      OR (
        OLD.plan_version_id IS NOT NULL
        AND OLD.period_number IS NOT NULL
        AND OLD.granted_microusd = 0
        AND OLD.reserved_microusd = 0
        AND OLD.consumed_microusd = 0
      ))
     AND (NEW.granted_microusd IS DISTINCT FROM 0
     OR NEW.reserved_microusd IS DISTINCT FROM 0
     OR NEW.consumed_microusd IS DISTINCT FROM 0) THEN
    RAISE EXCEPTION 'new subscription allowances cannot contain monetary value'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_allowances_token_only_check';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_allowances_traceable_token_only
BEFORE INSERT OR UPDATE ON "subscription_usage_allowances"
FOR EACH ROW
EXECUTE FUNCTION enforce_traceable_token_only_allowance();
--> statement-breakpoint
COMMENT ON COLUMN "subscriptions"."cycle_anchor_at" IS
  'Immutable UTC anchor used to derive every user-specific monthly subscription boundary.';
--> statement-breakpoint
COMMENT ON COLUMN "subscriptions"."current_period_number" IS
  'Zero-based monthly period number relative to cycle_anchor_at.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_usage_allowances"."plan_version_id" IS
  'Plan-version provenance for current and newly issued token allowances; nullable only for retained legacy periods.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_usage_allowances"."period_number" IS
  'Zero-based monthly period provenance; nullable only for retained legacy periods.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plans"."currency" IS
  'DEPRECATED compatibility column. Subscription plans are token-only and do not define or grant money.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_versions"."billing_period" IS
  'DEPRECATED compatibility discriminator fixed to monthly for all new and changed versions.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_versions"."base_price_microusd" IS
  'DEPRECATED historical monetary field. New and changed subscription versions must store zero.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_versions"."allowance_microusd" IS
  'DEPRECATED historical monetary allowance field. New and changed subscription versions must store zero.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_versions"."overage_policy" IS
  'DEPRECATED compatibility field fixed to deny; subscription exhaustion never falls back to cash balance.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_plan_versions"."effective_from" IS
  'DEPRECATED platform-wide effective date. User subscription periods are derived from cycle_anchor_at.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_usage_allowances"."granted_microusd" IS
  'DEPRECATED historical field. New subscription allowances are token-only and must store zero.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_usage_allowances"."reserved_microusd" IS
  'DEPRECATED historical field. New subscription allowances are token-only and must store zero.';
--> statement-breakpoint
COMMENT ON COLUMN "subscription_usage_allowances"."consumed_microusd" IS
  'DEPRECATED historical field. New subscription allowances are token-only and must store zero.';
--> statement-breakpoint
COMMENT ON COLUMN "gateway_requests"."allowance_reserved_microusd" IS
  'DEPRECATED historical subscription-allowance amount. New subscription requests reserve tokens only.';
--> statement-breakpoint
COMMENT ON COLUMN "gateway_requests"."allowance_charged_microusd" IS
  'DEPRECATED historical subscription-allowance amount. New subscription requests consume tokens only.';
