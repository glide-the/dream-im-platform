-- Database backstop for the Token-only monthly subscription contract.
-- Historical monetary rows remain readable; all new traced subscription
-- allowance and Gateway writes must be Token-only.

CREATE OR REPLACE FUNCTION subscription_month_boundary(
  anchor_at timestamp with time zone,
  boundary_number integer
)
RETURNS timestamp with time zone
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
AS $$
  WITH parts AS (
    SELECT
      anchor_at AT TIME ZONE 'UTC' AS utc_anchor,
      date_trunc('month', anchor_at AT TIME ZONE 'UTC')
        + make_interval(months => boundary_number) AS target_month
  ), clamped AS (
    SELECT
      target_month,
      LEAST(
        EXTRACT(day FROM utc_anchor)::integer,
        EXTRACT(
          day FROM target_month + INTERVAL '1 month' - INTERVAL '1 day'
        )::integer
      ) AS target_day,
      utc_anchor - date_trunc('day', utc_anchor) AS time_of_day
    FROM parts
  )
  SELECT (
    target_month
      + make_interval(days => target_day - 1)
      + time_of_day
  ) AT TIME ZONE 'UTC'
  FROM clamped
  WHERE boundary_number >= 0;
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    WITH candidates AS (
      SELECT
        subscription.id,
        MIN(allowance.period_start) AS recovered_anchor,
        subscription.current_period_start,
        subscription.current_period_end,
        (
          (
            EXTRACT(year FROM subscription.current_period_start AT TIME ZONE 'UTC')
            - EXTRACT(year FROM MIN(allowance.period_start) AT TIME ZONE 'UTC')
          ) * 12
          + EXTRACT(month FROM subscription.current_period_start AT TIME ZONE 'UTC')
          - EXTRACT(month FROM MIN(allowance.period_start) AT TIME ZONE 'UTC')
        )::integer AS recovered_period_number
      FROM subscriptions AS subscription
      JOIN subscription_usage_allowances AS allowance
        ON allowance.subscription_id = subscription.id
      WHERE subscription.current_period_number = 0
        AND subscription.cycle_anchor_at = subscription.current_period_start
      GROUP BY subscription.id
      HAVING MIN(allowance.period_start) < subscription.current_period_start
    )
    SELECT 1
    FROM candidates
    WHERE recovered_period_number < 1
       OR subscription_month_boundary(
            recovered_anchor,
            recovered_period_number
          ) IS DISTINCT FROM current_period_start
       OR subscription_month_boundary(
            recovered_anchor,
            recovered_period_number + 1
          ) IS DISTINCT FROM current_period_end
  ) THEN
    RAISE EXCEPTION 'ambiguous legacy subscription cycle anchor; migration blocked'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscriptions_legacy_anchor_recovery_check';
  END IF;
END;
$$;
--> statement-breakpoint
WITH candidates AS (
  SELECT
    subscription.id,
    MIN(allowance.period_start) AS recovered_anchor,
    (
      (
        EXTRACT(year FROM subscription.current_period_start AT TIME ZONE 'UTC')
        - EXTRACT(year FROM MIN(allowance.period_start) AT TIME ZONE 'UTC')
      ) * 12
      + EXTRACT(month FROM subscription.current_period_start AT TIME ZONE 'UTC')
      - EXTRACT(month FROM MIN(allowance.period_start) AT TIME ZONE 'UTC')
    )::integer AS recovered_period_number
  FROM subscriptions AS subscription
  JOIN subscription_usage_allowances AS allowance
    ON allowance.subscription_id = subscription.id
  WHERE subscription.current_period_number = 0
    AND subscription.cycle_anchor_at = subscription.current_period_start
  GROUP BY subscription.id
  HAVING MIN(allowance.period_start) < subscription.current_period_start
), recovered AS (
  UPDATE subscriptions AS subscription
  SET cycle_anchor_at = candidate.recovered_anchor,
      current_period_number = candidate.recovered_period_number,
      updated_at = NOW()
  FROM candidates AS candidate
  WHERE subscription.id = candidate.id
  RETURNING subscription.id,
            subscription.current_period_start,
            subscription.current_period_end,
            subscription.current_period_number
)
UPDATE subscription_usage_allowances AS allowance
SET period_number = recovered.current_period_number,
    updated_at = NOW()
FROM recovered
WHERE allowance.subscription_id = recovered.id
  AND allowance.period_start = recovered.current_period_start
  AND allowance.period_end = recovered.current_period_end;
--> statement-breakpoint
COMMENT ON FUNCTION subscription_month_boundary(timestamp with time zone, integer) IS
  'Returns a UTC monthly boundary from the immutable original user anchor while preserving month-end intent.';
--> statement-breakpoint
ALTER TABLE "gateway_requests"
ADD CONSTRAINT "gateway_requests_token_subscription_money_zero_check"
CHECK (
  "subscription_coverage_mode" IS DISTINCT FROM 'token_allowance'
  OR (
    "allowance_reserved_microusd" = 0
    AND "allowance_charged_microusd" = 0
  )
);
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_token_subscription_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'past_due' THEN
      RAISE EXCEPTION 'Token-only subscriptions cannot enter past_due'
        USING ERRCODE = '23514',
              CONSTRAINT = 'subscriptions_token_only_state_check';
    END IF;
    IF NEW.current_period_number = 0
       AND NEW.cycle_anchor_at IS DISTINCT FROM NEW.current_period_start THEN
      RAISE EXCEPTION 'initial subscription period must start at cycle anchor'
        USING ERRCODE = '23514',
              CONSTRAINT = 'subscriptions_cycle_anchor_check';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.cycle_anchor_at IS DISTINCT FROM OLD.cycle_anchor_at THEN
    RAISE EXCEPTION 'subscription cycle anchor is immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscriptions_cycle_anchor_immutable_check';
  END IF;
  IF NEW.status = 'past_due' AND OLD.status IS DISTINCT FROM 'past_due' THEN
    RAISE EXCEPTION 'Token-only subscriptions cannot enter past_due'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscriptions_token_only_state_check';
  END IF;
  IF OLD.status IN ('cancelled', 'expired') THEN
    RAISE EXCEPTION 'terminal subscriptions are immutable; create a new subscription'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscriptions_terminal_immutable_check';
  END IF;
  IF NEW.current_period_number < OLD.current_period_number THEN
    RAISE EXCEPTION 'subscription period number cannot move backwards'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscriptions_period_monotonic_check';
  END IF;
  IF NEW.current_period_number = OLD.current_period_number
     AND (
       NEW.current_period_start IS DISTINCT FROM OLD.current_period_start
       OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
     ) THEN
    RAISE EXCEPTION 'subscription boundaries cannot change inside a period'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscriptions_period_boundary_immutable_check';
  END IF;
  IF NEW.current_period_number > OLD.current_period_number
     AND NEW.status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'only an active renewal can advance a subscription period'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscriptions_period_advance_state_check';
  END IF;
  IF NEW.version IS DISTINCT FROM OLD.version + 1 THEN
    RAISE EXCEPTION 'subscription mutations must increment version exactly once'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscriptions_version_increment_check';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS subscriptions_token_lifecycle_guard ON "subscriptions";
--> statement-breakpoint
CREATE TRIGGER subscriptions_token_lifecycle_guard
BEFORE INSERT OR UPDATE ON "subscriptions"
FOR EACH ROW
EXECUTE FUNCTION enforce_token_subscription_lifecycle();
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
    RAISE EXCEPTION 'subscription allowance grant and provenance are immutable'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_allowances_provenance_immutable_check';
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
COMMENT ON FUNCTION enforce_token_subscription_lifecycle() IS
  'Rejects past_due entry, anchor drift, terminal mutation, non-monotonic periods and missing optimistic version increments for Token-only subscriptions.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_gateway_usage_fact_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'gateway request facts cannot be deleted'
      USING ERRCODE = '55000',
            CONSTRAINT = 'gateway_requests_no_delete';
  END IF;

  IF OLD.settled_at IS NOT NULL
     AND (
       NEW.platform_user_id IS DISTINCT FROM OLD.platform_user_id
       OR NEW.gateway_api_key_id IS DISTINCT FROM OLD.gateway_api_key_id
       OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
       OR NEW.model_id IS DISTINCT FROM OLD.model_id
       OR NEW.pricing_rule_id IS DISTINCT FROM OLD.pricing_rule_id
       OR NEW.protocol IS DISTINCT FROM OLD.protocol
       OR NEW.requested_model IS DISTINCT FROM OLD.requested_model
       OR NEW.resolved_model IS DISTINCT FROM OLD.resolved_model
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.outcome IS DISTINCT FROM OLD.outcome
       OR NEW.input_token_semantics IS DISTINCT FROM OLD.input_token_semantics
       OR NEW.input_tokens IS DISTINCT FROM OLD.input_tokens
       OR NEW.output_tokens IS DISTINCT FROM OLD.output_tokens
       OR NEW.cache_read_tokens IS DISTINCT FROM OLD.cache_read_tokens
       OR NEW.cache_write_tokens IS DISTINCT FROM OLD.cache_write_tokens
       OR NEW.estimated_tokens IS DISTINCT FROM OLD.estimated_tokens
       OR NEW.input_price_snapshot IS DISTINCT FROM OLD.input_price_snapshot
       OR NEW.output_price_snapshot IS DISTINCT FROM OLD.output_price_snapshot
       OR NEW.cache_read_price_snapshot IS DISTINCT FROM OLD.cache_read_price_snapshot
       OR NEW.cache_write_price_snapshot IS DISTINCT FROM OLD.cache_write_price_snapshot
       OR NEW.markup_bps_snapshot IS DISTINCT FROM OLD.markup_bps_snapshot
       OR NEW.discount_bps_snapshot IS DISTINCT FROM OLD.discount_bps_snapshot
       OR NEW.subscription_id IS DISTINCT FROM OLD.subscription_id
       OR NEW.subscription_plan_version_id IS DISTINCT FROM OLD.subscription_plan_version_id
       OR NEW.subscription_entitlement_id IS DISTINCT FROM OLD.subscription_entitlement_id
       OR NEW.subscription_allowance_id IS DISTINCT FROM OLD.subscription_allowance_id
       OR NEW.subscription_coverage_mode IS DISTINCT FROM OLD.subscription_coverage_mode
       OR NEW.allowance_reserved_microusd IS DISTINCT FROM OLD.allowance_reserved_microusd
       OR NEW.allowance_charged_microusd IS DISTINCT FROM OLD.allowance_charged_microusd
       OR NEW.allowance_reserved_tokens IS DISTINCT FROM OLD.allowance_reserved_tokens
       OR NEW.allowance_charged_tokens IS DISTINCT FROM OLD.allowance_charged_tokens
       OR NEW.reserved_microusd IS DISTINCT FROM OLD.reserved_microusd
       OR NEW.provider_cost_microusd IS DISTINCT FROM OLD.provider_cost_microusd
       OR NEW.charged_microusd IS DISTINCT FROM OLD.charged_microusd
       OR NEW.http_status IS DISTINCT FROM OLD.http_status
       OR NEW.error_code IS DISTINCT FROM OLD.error_code
       OR NEW.error_message IS DISTINCT FROM OLD.error_message
       OR NEW.response_summary IS DISTINCT FROM OLD.response_summary
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.settled_at IS DISTINCT FROM OLD.settled_at
     ) THEN
    RAISE EXCEPTION 'settled gateway usage facts are immutable'
      USING ERRCODE = '55000',
            CONSTRAINT = 'gateway_requests_settled_usage_immutable';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS gateway_requests_usage_fact_guard ON "gateway_requests";
--> statement-breakpoint
CREATE TRIGGER gateway_requests_usage_fact_guard
BEFORE UPDATE OR DELETE ON "gateway_requests"
FOR EACH ROW
EXECUTE FUNCTION prevent_gateway_usage_fact_mutation();
--> statement-breakpoint
COMMENT ON FUNCTION prevent_gateway_usage_fact_mutation() IS
  'Makes final Gateway Token usage and settlement snapshots immutable while allowing payload-capture bookkeeping fields to finish independently.';
