CREATE OR REPLACE FUNCTION enforce_token_subscription_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  renewal_price_microusd bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'past_due' THEN
      RAISE EXCEPTION 'subscriptions cannot be inserted directly as past_due'
        USING ERRCODE = '23514',
              CONSTRAINT = 'subscriptions_paid_state_check';
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
    SELECT version.base_price_microusd
      INTO renewal_price_microusd
      FROM subscription_plan_versions AS version
     WHERE version.id = COALESCE(NEW.pending_plan_version_id, NEW.plan_version_id)
       AND version.status = 'published';
    IF OLD.status NOT IN ('trial', 'active')
       OR renewal_price_microusd IS NULL
       OR renewal_price_microusd <= 0
       OR NEW.current_period_number IS DISTINCT FROM OLD.current_period_number
       OR NEW.current_period_start IS DISTINCT FROM OLD.current_period_start
       OR NEW.current_period_end IS DISTINCT FROM OLD.current_period_end
       OR NEW.current_period_end > statement_timestamp()
       OR NEW.renewal_enabled IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'only a due priced monthly subscription can enter past_due'
        USING ERRCODE = '23514',
              CONSTRAINT = 'subscriptions_paid_state_check';
    END IF;
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
COMMENT ON FUNCTION enforce_token_subscription_lifecycle() IS
  'Guards immutable personal cycles. Only an elapsed, positively priced published version may enter past_due while awaiting a verified renewal payment.';
