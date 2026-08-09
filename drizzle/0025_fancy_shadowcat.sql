ALTER TABLE "subscription_plans"
  ADD COLUMN "display_eyebrow" text,
  ADD COLUMN "display_note" text,
  ADD COLUMN "display_details" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.jsonb_is_string_array(value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_typeof(value) = 'array'
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(value) AS item
      WHERE jsonb_typeof(item) <> 'string'
    );
$$;
--> statement-breakpoint
ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_display_details_check"
  CHECK (public.jsonb_is_string_array("display_details"));
--> statement-breakpoint
ALTER TABLE "subscription_plan_entitlements"
  ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_entitlements_one_default_uidx"
  ON "subscription_plan_entitlements" ("plan_version_id")
  WHERE "is_default" = TRUE;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.provision_default_free_subscription(
  p_canonical_user_id bigint
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_platform_user_id text;
  v_plan_version_id text;
  v_allowance_tokens bigint;
  v_subscription_id text;
  v_allowance_id text;
  v_event_id text;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  SELECT platform_user.id
    INTO v_platform_user_id
  FROM platform_users AS platform_user
  WHERE platform_user.source = 'ink-dream'
    AND platform_user.external_user_id = p_canonical_user_id::text
    AND platform_user.status = 'active';

  IF v_platform_user_id IS NULL THEN
    RAISE EXCEPTION 'canonical user platform projection is not ready'
      USING ERRCODE = '23514',
            CONSTRAINT = 'default_free_projection_ready_check';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('default-free:' || v_platform_user_id, 0));

  IF EXISTS (
    SELECT 1
    FROM subscriptions AS subscription
    WHERE subscription.platform_user_id = v_platform_user_id
      AND subscription.status IN (
        'trial', 'active', 'past_due', 'paused', 'cancel_at_period_end'
      )
  ) THEN
    RETURN NULL;
  END IF;

  SELECT version.id, version.allowance_tokens
    INTO v_plan_version_id, v_allowance_tokens
  FROM subscription_plans AS plan
  JOIN subscription_plan_versions AS version ON version.plan_id = plan.id
  WHERE plan.code = 'free'
    AND plan.status = 'active'
    AND version.status = 'published'
    AND version.billing_period = 'monthly'
    AND version.base_price_microusd = 0
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
        AND entitlement.is_default = TRUE
        AND entitlement.gateway_scopes @> ARRAY['messages:create']::text[]
        AND model.enabled = TRUE
    )
  ORDER BY version.version_number DESC
  LIMIT 1;

  IF v_plan_version_id IS NULL THEN
    -- Deployment is blocked by `pnpm plans:check`; keeping the trigger a no-op
    -- before the seed lets migrations and pre-seed fixtures establish model
    -- configuration without creating a partial subscription.
    RETURN NULL;
  END IF;

  v_subscription_id := 'sub_free_' || md5(v_platform_user_id || ':' || v_plan_version_id);
  v_allowance_id := 'allow_free_' || md5(v_platform_user_id || ':' || v_plan_version_id);
  v_event_id := 'subevt_free_' || md5(v_platform_user_id || ':' || v_plan_version_id);
  v_period_start := clock_timestamp();
  v_period_end := v_period_start + interval '1 month';

  INSERT INTO subscriptions (
    id, platform_user_id, plan_version_id, status,
    cycle_anchor_at, current_period_number,
    current_period_start, current_period_end, renewal_enabled
  ) VALUES (
    v_subscription_id, v_platform_user_id, v_plan_version_id, 'active',
    v_period_start, 0, v_period_start, v_period_end, TRUE
  );

  INSERT INTO subscription_usage_allowances (
    id, subscription_id, plan_version_id, period_number,
    period_start, period_end, granted_tokens
  ) VALUES (
    v_allowance_id, v_subscription_id, v_plan_version_id, 0,
    v_period_start, v_period_end, v_allowance_tokens
  );

  INSERT INTO subscription_events (
    id, subscription_id, event_type, idempotency_key,
    actor_type, actor_id, reason, before, after, metadata
  ) VALUES (
    v_event_id, v_subscription_id, 'activated',
    'default-free:' || v_platform_user_id || ':' || v_plan_version_id,
    'system', 'default-free-provisioner',
    'Automatically provisioned the default Free monthly subscription',
    NULL,
    jsonb_build_object(
      'id', v_subscription_id,
      'status', 'active',
      'planVersionId', v_plan_version_id,
      'currentPeriodStart', v_period_start,
      'currentPeriodEnd', v_period_end
    ),
    jsonb_build_object(
      'allowanceId', v_allowance_id,
      'periodNumber', 0,
      'source', 'default-free'
    )
  );

  RETURN v_subscription_id;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.provision_default_free_subscription_after_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.provision_default_free_subscription(NEW.id);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS zz_users_default_free_subscription ON public.users;
--> statement-breakpoint
CREATE TRIGGER zz_users_default_free_subscription
AFTER INSERT ON public.users
FOR EACH ROW
EXECUTE FUNCTION public.provision_default_free_subscription_after_user();
--> statement-breakpoint
COMMENT ON FUNCTION public.provision_default_free_subscription(bigint) IS
  'Idempotently provisions the published Free monthly subscription, allowance and activation event without replacing preserved non-terminal subscriptions.';
