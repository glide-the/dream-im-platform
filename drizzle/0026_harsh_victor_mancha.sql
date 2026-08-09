CREATE TABLE "subscription_token_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"platform_user_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"plan_version_id" text NOT NULL,
	"subscription_allowance_id" text NOT NULL,
	"amount_tokens" bigint NOT NULL,
	"bonus_before_tokens" bigint NOT NULL,
	"bonus_after_tokens" bigint NOT NULL,
	"available_before_tokens" bigint NOT NULL,
	"available_after_tokens" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"actor_type" text DEFAULT 'admin' NOT NULL,
	"actor_id" text NOT NULL,
	"reason" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_token_grants_amount_check" CHECK ("subscription_token_grants"."amount_tokens" > 0),
	CONSTRAINT "subscription_token_grants_bonus_transition_check" CHECK ("subscription_token_grants"."bonus_before_tokens" >= 0 AND "subscription_token_grants"."bonus_after_tokens" = "subscription_token_grants"."bonus_before_tokens" + "subscription_token_grants"."amount_tokens"),
	CONSTRAINT "subscription_token_grants_available_transition_check" CHECK ("subscription_token_grants"."available_before_tokens" >= 0 AND "subscription_token_grants"."available_after_tokens" = "subscription_token_grants"."available_before_tokens" + "subscription_token_grants"."amount_tokens"),
	CONSTRAINT "subscription_token_grants_actor_check" CHECK ("subscription_token_grants"."actor_type" IN ('admin', 'system')),
	CONSTRAINT "subscription_token_grants_reason_check" CHECK (length(btrim("subscription_token_grants"."reason")) BETWEEN 3 AND 500),
	CONSTRAINT "subscription_token_grants_metadata_check" CHECK (jsonb_typeof("subscription_token_grants"."metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "subscription_usage_allowances" DROP CONSTRAINT "subscription_allowances_balance_check";--> statement-breakpoint
ALTER TABLE "subscription_usage_allowances" ADD COLUMN "bonus_granted_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "subscription_token_grants" ADD CONSTRAINT "subscription_token_grants_platform_user_id_platform_users_id_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_token_grants" ADD CONSTRAINT "subscription_token_grants_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_token_grants" ADD CONSTRAINT "subscription_token_grants_plan_version_id_subscription_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."subscription_plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_token_grants" ADD CONSTRAINT "subscription_token_grants_subscription_allowance_id_subscription_usage_allowances_id_fk" FOREIGN KEY ("subscription_allowance_id") REFERENCES "public"."subscription_usage_allowances"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_token_grants_idempotency_uidx" ON "subscription_token_grants" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "subscription_token_grants_allowance_created_idx" ON "subscription_token_grants" USING btree ("subscription_allowance_id","created_at");--> statement-breakpoint
CREATE INDEX "subscription_token_grants_subscription_created_idx" ON "subscription_token_grants" USING btree ("subscription_id","created_at");--> statement-breakpoint
ALTER TABLE "subscription_usage_allowances" ADD CONSTRAINT "subscription_allowances_balance_check" CHECK ("subscription_usage_allowances"."granted_tokens" >= 0 AND "subscription_usage_allowances"."bonus_granted_tokens" >= 0 AND "subscription_usage_allowances"."reserved_tokens" >= 0 AND "subscription_usage_allowances"."consumed_tokens" >= 0 AND "subscription_usage_allowances"."reserved_tokens" + "subscription_usage_allowances"."consumed_tokens" <= "subscription_usage_allowances"."granted_tokens" + "subscription_usage_allowances"."bonus_granted_tokens" AND "subscription_usage_allowances"."granted_microusd" >= 0 AND "subscription_usage_allowances"."reserved_microusd" >= 0 AND "subscription_usage_allowances"."consumed_microusd" >= 0 AND "subscription_usage_allowances"."reserved_microusd" + "subscription_usage_allowances"."consumed_microusd" <= "subscription_usage_allowances"."granted_microusd");
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
       OR NEW.period_start IS DISTINCT FROM OLD.period_start
       OR NEW.period_end IS DISTINCT FROM OLD.period_end
       OR NEW.granted_tokens IS DISTINCT FROM OLD.granted_tokens
       OR NEW.granted_microusd IS DISTINCT FROM OLD.granted_microusd
     ) THEN
    RAISE EXCEPTION 'subscription allowance plan grant and provenance are immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_allowances_provenance_immutable_check';
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.bonus_granted_tokens < OLD.bonus_granted_tokens THEN
    RAISE EXCEPTION 'subscription bonus Token grants cannot be reduced or overwritten'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_allowances_bonus_monotonic_check';
  END IF;

  IF (TG_OP = 'INSERT' OR OLD.plan_version_id IS NOT NULL)
     AND (
       NEW.granted_microusd IS DISTINCT FROM 0
       OR NEW.reserved_microusd IS DISTINCT FROM 0
       OR NEW.consumed_microusd IS DISTINCT FROM 0
     ) THEN
    RAISE EXCEPTION 'traced subscription allowances cannot contain monetary value'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_allowances_token_only_check';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_subscription_token_grant_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM subscriptions AS subscription
    JOIN subscription_usage_allowances AS allowance
      ON allowance.id = NEW.subscription_allowance_id
     AND allowance.subscription_id = subscription.id
     AND allowance.plan_version_id = NEW.plan_version_id
    WHERE subscription.id = NEW.subscription_id
      AND subscription.platform_user_id = NEW.platform_user_id
      AND allowance.bonus_granted_tokens = NEW.bonus_after_tokens
      AND NEW.bonus_before_tokens + NEW.amount_tokens = NEW.bonus_after_tokens
      AND allowance.granted_tokens + allowance.bonus_granted_tokens
          - allowance.reserved_tokens - allowance.consumed_tokens
          = NEW.available_after_tokens
  ) THEN
    RAISE EXCEPTION 'subscription Token grant provenance does not match its current allowance'
      USING ERRCODE = '23503',
            CONSTRAINT = 'subscription_token_grants_provenance_fk';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_token_grants_provenance
BEFORE INSERT ON "subscription_token_grants"
FOR EACH ROW
EXECUTE FUNCTION assert_subscription_token_grant_provenance();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_subscription_token_grant_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'subscription Token grant records are append-only'
    USING ERRCODE = '55000',
          CONSTRAINT = 'subscription_token_grants_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_token_grants_no_update
BEFORE UPDATE ON "subscription_token_grants"
FOR EACH ROW
EXECUTE FUNCTION prevent_subscription_token_grant_mutation();
--> statement-breakpoint
CREATE TRIGGER subscription_token_grants_no_delete
BEFORE DELETE ON "subscription_token_grants"
FOR EACH ROW
EXECUTE FUNCTION prevent_subscription_token_grant_mutation();
--> statement-breakpoint
INSERT INTO admin_permissions (id, code, name, description)
VALUES (
  'permission_subscriptions_grant',
  'subscriptions.grant',
  'Grant subscription Tokens',
  'Append audited free Token grants to the current subscription period'
)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description;
--> statement-breakpoint
INSERT INTO admin_role_permissions (role_id, permission_id)
SELECT role.id, permission.id
FROM admin_roles AS role
JOIN admin_permissions AS permission
  ON permission.code = 'subscriptions.grant'
WHERE role.code = 'super_admin'
ON CONFLICT DO NOTHING;
--> statement-breakpoint
COMMENT ON COLUMN subscription_usage_allowances.bonus_granted_tokens IS
  'Append-only current-period Token grants outside the immutable plan-version allowance.';
--> statement-breakpoint
COMMENT ON TABLE subscription_token_grants IS
  'Immutable, idempotent and audited free Token grants for one current subscription allowance; never money or a recurring plan entitlement.';
