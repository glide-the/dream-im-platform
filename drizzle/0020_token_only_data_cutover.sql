-- Convert callable canonical-user subscriptions that still reference a
-- historical monetary Plan Version into a new immutable Token-only lineage.
--
-- Historical Plan Versions, allowances, usage, ledger entries and events are
-- never rewritten.  The cutover is intentionally fail-closed when a current
-- legacy allowance has already been reserved or consumed: those subscriptions
-- must cross the boundary through an operator-reviewed forward migration.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM subscriptions AS subscription
    JOIN platform_users AS platform_user
      ON platform_user.id = subscription.platform_user_id
    JOIN users AS canonical_user
      ON platform_user.source = 'ink-dream'
     AND platform_user.external_user_id = canonical_user.id::text
    JOIN subscription_plan_versions AS version
      ON version.id = subscription.plan_version_id
    WHERE subscription.status IN (
      'trial', 'active', 'past_due', 'paused', 'cancel_at_period_end'
    )
      AND (
        version.billing_period IS DISTINCT FROM 'monthly'
        OR version.base_price_microusd IS DISTINCT FROM 0
        OR version.allowance_microusd IS DISTINCT FROM 0
        OR version.overage_policy IS DISTINCT FROM 'deny'
        OR version.effective_from IS NOT NULL
      )
      AND subscription.status = 'past_due'
  ) THEN
    RAISE EXCEPTION 'past_due legacy subscriptions require operator review before Token-only cutover'
      USING ERRCODE = '23514',
            CONSTRAINT = 'token_only_cutover_past_due_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM subscriptions AS subscription
    JOIN platform_users AS platform_user
      ON platform_user.id = subscription.platform_user_id
    JOIN users AS canonical_user
      ON platform_user.source = 'ink-dream'
     AND platform_user.external_user_id = canonical_user.id::text
    JOIN subscription_plan_versions AS version
      ON version.id = subscription.plan_version_id
    WHERE subscription.status IN (
      'trial', 'active', 'paused', 'cancel_at_period_end'
    )
      AND (
        version.billing_period IS DISTINCT FROM 'monthly'
        OR version.base_price_microusd IS DISTINCT FROM 0
        OR version.allowance_microusd IS DISTINCT FROM 0
        OR version.overage_policy IS DISTINCT FROM 'deny'
        OR version.effective_from IS NOT NULL
      )
      AND (
        subscription.pending_plan_version_id IS NOT NULL
        OR subscription.current_period_end <= NOW()
        OR (
          subscription.status = 'trial'
          AND (
            subscription.trial_ends_at IS NULL
            OR subscription.trial_ends_at <= NOW()
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'legacy subscription state is ambiguous for automatic Token-only cutover'
      USING ERRCODE = '23514',
            CONSTRAINT = 'token_only_cutover_subscription_state_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM subscriptions AS subscription
    JOIN platform_users AS platform_user
      ON platform_user.id = subscription.platform_user_id
    JOIN users AS canonical_user
      ON platform_user.source = 'ink-dream'
     AND platform_user.external_user_id = canonical_user.id::text
    JOIN subscription_plan_versions AS version
      ON version.id = subscription.plan_version_id
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::integer AS allowance_count,
             COALESCE(MAX(allowance.plan_version_id), '') AS plan_version_id,
             COALESCE(MAX(allowance.period_number), -1) AS period_number,
             COALESCE(MAX(allowance.reserved_tokens), -1) AS reserved_tokens,
             COALESCE(MAX(allowance.consumed_tokens), -1) AS consumed_tokens
      FROM subscription_usage_allowances AS allowance
      WHERE allowance.subscription_id = subscription.id
        AND allowance.period_start = subscription.current_period_start
        AND allowance.period_end = subscription.current_period_end
    ) AS current_allowance ON TRUE
    WHERE subscription.status IN (
      'trial', 'active', 'paused', 'cancel_at_period_end'
    )
      AND (
        version.billing_period IS DISTINCT FROM 'monthly'
        OR version.base_price_microusd IS DISTINCT FROM 0
        OR version.allowance_microusd IS DISTINCT FROM 0
        OR version.overage_policy IS DISTINCT FROM 'deny'
        OR version.effective_from IS NOT NULL
      )
      AND (
        current_allowance.allowance_count IS DISTINCT FROM 1
        OR current_allowance.plan_version_id IS DISTINCT FROM version.id
        OR current_allowance.period_number IS DISTINCT FROM subscription.current_period_number
        OR current_allowance.reserved_tokens IS DISTINCT FROM 0
        OR current_allowance.consumed_tokens IS DISTINCT FROM 0
      )
  ) THEN
    RAISE EXCEPTION 'legacy allowance provenance or usage blocks automatic Token-only cutover'
      USING ERRCODE = '23514',
            CONSTRAINT = 'token_only_cutover_allowance_check';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM subscriptions AS subscription
    JOIN platform_users AS platform_user
      ON platform_user.id = subscription.platform_user_id
    JOIN users AS canonical_user
      ON platform_user.source = 'ink-dream'
     AND platform_user.external_user_id = canonical_user.id::text
    JOIN subscription_plan_versions AS version
      ON version.id = subscription.plan_version_id
    WHERE subscription.status IN (
      'trial', 'active', 'paused', 'cancel_at_period_end'
    )
      AND (
        version.billing_period IS DISTINCT FROM 'monthly'
        OR version.base_price_microusd IS DISTINCT FROM 0
        OR version.allowance_microusd IS DISTINCT FROM 0
        OR version.overage_policy IS DISTINCT FROM 'deny'
        OR version.effective_from IS NOT NULL
      )
      AND NOT EXISTS (
        SELECT 1
        FROM subscription_plan_entitlements AS entitlement
        WHERE entitlement.plan_version_id = version.id
          AND entitlement.enabled = TRUE
      )
  ) THEN
    RAISE EXCEPTION 'legacy Plan Version has no enabled entitlement to copy'
      USING ERRCODE = '23514',
            CONSTRAINT = 'token_only_cutover_entitlement_check';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TEMP TABLE token_only_plan_cutover
ON COMMIT DROP
AS
WITH legacy_versions AS (
  SELECT DISTINCT version.*
  FROM subscriptions AS subscription
  JOIN platform_users AS platform_user
    ON platform_user.id = subscription.platform_user_id
  JOIN users AS canonical_user
    ON platform_user.source = 'ink-dream'
   AND platform_user.external_user_id = canonical_user.id::text
  JOIN subscription_plan_versions AS version
    ON version.id = subscription.plan_version_id
  WHERE subscription.status IN (
    'trial', 'active', 'paused', 'cancel_at_period_end'
  )
    AND (
      version.billing_period IS DISTINCT FROM 'monthly'
      OR version.base_price_microusd IS DISTINCT FROM 0
      OR version.allowance_microusd IS DISTINCT FROM 0
      OR version.overage_policy IS DISTINCT FROM 'deny'
      OR version.effective_from IS NOT NULL
    )
), plan_maximum AS (
  SELECT plan_id, MAX(version_number) AS maximum_version_number
  FROM subscription_plan_versions
  GROUP BY plan_id
), numbered AS (
  SELECT legacy_versions.*,
         plan_maximum.maximum_version_number
         + ROW_NUMBER() OVER (
           PARTITION BY legacy_versions.plan_id
           ORDER BY legacy_versions.version_number, legacy_versions.id
         ) AS successor_version_number
  FROM legacy_versions
  JOIN plan_maximum
    ON plan_maximum.plan_id = legacy_versions.plan_id
)
SELECT id AS legacy_plan_version_id,
       'planv_token_' || md5(id) AS successor_plan_version_id,
       plan_id,
       successor_version_number,
       trial_days,
       grace_period_days,
       allowance_tokens
FROM numbered;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM token_only_plan_cutover AS cutover
    JOIN subscription_plan_versions AS existing
      ON existing.id = cutover.successor_plan_version_id
  ) THEN
    RAISE EXCEPTION 'deterministic Token-only Plan Version id already exists'
      USING ERRCODE = '23505',
            CONSTRAINT = 'token_only_cutover_plan_version_id_check';
  END IF;
END;
$$;
--> statement-breakpoint
INSERT INTO subscription_plan_versions (
  id, plan_id, version_number, status, billing_period,
  base_price_microusd, trial_days, grace_period_days,
  allowance_tokens, allowance_microusd, overage_policy, effective_from
)
SELECT successor_plan_version_id, plan_id, successor_version_number,
       'draft', 'monthly', 0, trial_days, grace_period_days,
       allowance_tokens, 0, 'deny', NULL
FROM token_only_plan_cutover;
--> statement-breakpoint
INSERT INTO subscription_plan_entitlements (
  id, plan_version_id, model_id, gateway_scopes,
  requests_per_minute, daily_token_limit, monthly_token_limit,
  storage_bytes_limit, enabled
)
SELECT 'ent_token_' || md5(entitlement.id),
       cutover.successor_plan_version_id,
       entitlement.model_id,
       entitlement.gateway_scopes,
       entitlement.requests_per_minute,
       entitlement.daily_token_limit,
       entitlement.monthly_token_limit,
       entitlement.storage_bytes_limit,
       entitlement.enabled
FROM token_only_plan_cutover AS cutover
JOIN subscription_plan_entitlements AS entitlement
  ON entitlement.plan_version_id = cutover.legacy_plan_version_id;
--> statement-breakpoint
UPDATE subscription_plan_versions AS version
SET status = 'published',
    published_at = NOW(),
    updated_at = NOW()
FROM token_only_plan_cutover AS cutover
WHERE version.id = cutover.successor_plan_version_id
  AND version.status = 'draft';
--> statement-breakpoint
CREATE TEMP TABLE token_only_subscription_cutover
ON COMMIT DROP
AS
SELECT subscription.id AS legacy_subscription_id,
       'sub_token_' || md5(subscription.id) AS successor_subscription_id,
       subscription.platform_user_id,
       subscription.plan_version_id AS legacy_plan_version_id,
       plan_cutover.successor_plan_version_id,
       subscription.status AS legacy_status,
       subscription.cycle_anchor_at,
       subscription.current_period_number,
       subscription.current_period_start,
       subscription.current_period_end,
       subscription.trial_ends_at,
       subscription.renewal_enabled,
       subscription.paused_at,
       subscription.version AS legacy_version,
       allowance.id AS legacy_allowance_id,
       'allow_token_' || md5(allowance.id) AS successor_allowance_id,
       allowance.granted_tokens
FROM subscriptions AS subscription
JOIN platform_users AS platform_user
  ON platform_user.id = subscription.platform_user_id
JOIN users AS canonical_user
  ON platform_user.source = 'ink-dream'
 AND platform_user.external_user_id = canonical_user.id::text
JOIN token_only_plan_cutover AS plan_cutover
  ON plan_cutover.legacy_plan_version_id = subscription.plan_version_id
JOIN subscription_usage_allowances AS allowance
  ON allowance.subscription_id = subscription.id
 AND allowance.period_start = subscription.current_period_start
 AND allowance.period_end = subscription.current_period_end
WHERE subscription.status IN (
  'trial', 'active', 'paused', 'cancel_at_period_end'
);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM token_only_subscription_cutover AS cutover
    LEFT JOIN subscriptions AS successor
      ON successor.id = cutover.successor_subscription_id
    LEFT JOIN subscription_usage_allowances AS successor_allowance
      ON successor_allowance.id = cutover.successor_allowance_id
    WHERE successor.id IS NOT NULL OR successor_allowance.id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'deterministic Token-only Subscription id already exists'
      USING ERRCODE = '23505',
            CONSTRAINT = 'token_only_cutover_subscription_id_check';
  END IF;
END;
$$;
--> statement-breakpoint
UPDATE subscriptions AS subscription
SET status = 'expired',
    renewal_enabled = FALSE,
    version = subscription.version + 1,
    updated_at = NOW()
FROM token_only_subscription_cutover AS cutover
WHERE subscription.id = cutover.legacy_subscription_id
  AND subscription.version = cutover.legacy_version;
--> statement-breakpoint
INSERT INTO subscriptions (
  id, platform_user_id, plan_version_id, status,
  current_period_start, current_period_end, trial_ends_at,
  renewal_enabled, paused_at, version, cycle_anchor_at,
  current_period_number
)
SELECT successor_subscription_id, platform_user_id,
       successor_plan_version_id, legacy_status,
       current_period_start, current_period_end, trial_ends_at,
       renewal_enabled, paused_at, 1, cycle_anchor_at,
       current_period_number
FROM token_only_subscription_cutover;
--> statement-breakpoint
INSERT INTO subscription_usage_allowances (
  id, subscription_id, plan_version_id, period_number,
  period_start, period_end, granted_tokens,
  reserved_tokens, consumed_tokens,
  granted_microusd, reserved_microusd, consumed_microusd
)
SELECT successor_allowance_id, successor_subscription_id,
       successor_plan_version_id, current_period_number,
       current_period_start, current_period_end, granted_tokens,
       0, 0, 0, 0, 0
FROM token_only_subscription_cutover;
--> statement-breakpoint
INSERT INTO subscription_events (
  id, subscription_id, event_type, idempotency_key,
  actor_type, actor_id, reason, before, after, metadata
)
SELECT 'subevt_token_legacy_' || md5(legacy_subscription_id),
       legacy_subscription_id,
       'token_only_superseded',
       'token-only-cutover:legacy:' || legacy_subscription_id,
       'system', 'drizzle-0020',
       'Superseded by an immutable Token-only monthly subscription',
       jsonb_build_object(
         'subscriptionId', legacy_subscription_id,
         'planVersionId', legacy_plan_version_id,
         'status', legacy_status,
         'version', legacy_version
       ),
       jsonb_build_object(
         'subscriptionId', legacy_subscription_id,
         'status', 'expired',
         'version', legacy_version + 1
       ),
       jsonb_build_object(
         'successorSubscriptionId', successor_subscription_id,
         'successorPlanVersionId', successor_plan_version_id,
         'legacyAllowanceId', legacy_allowance_id
       )
FROM token_only_subscription_cutover;
--> statement-breakpoint
INSERT INTO subscription_events (
  id, subscription_id, event_type, idempotency_key,
  actor_type, actor_id, reason, before, after, metadata
)
SELECT 'subevt_token_new_' || md5(successor_subscription_id),
       successor_subscription_id,
       'token_only_activated',
       'token-only-cutover:successor:' || legacy_subscription_id,
       'system', 'drizzle-0020',
       'Activated from a legacy subscription without rewriting history',
       NULL,
       jsonb_build_object(
         'subscriptionId', successor_subscription_id,
         'planVersionId', successor_plan_version_id,
         'status', legacy_status,
         'version', 1
       ),
       jsonb_build_object(
         'predecessorSubscriptionId', legacy_subscription_id,
         'predecessorPlanVersionId', legacy_plan_version_id,
         'allowanceId', successor_allowance_id,
         'periodNumber', current_period_number
       )
FROM token_only_subscription_cutover;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM subscriptions AS subscription
    JOIN platform_users AS platform_user
      ON platform_user.id = subscription.platform_user_id
    JOIN users AS canonical_user
      ON platform_user.source = 'ink-dream'
     AND platform_user.external_user_id = canonical_user.id::text
    JOIN subscription_plan_versions AS version
      ON version.id = subscription.plan_version_id
    WHERE subscription.status IN (
      'trial', 'active', 'paused', 'cancel_at_period_end'
    )
      AND (
        version.billing_period IS DISTINCT FROM 'monthly'
        OR version.base_price_microusd IS DISTINCT FROM 0
        OR version.allowance_microusd IS DISTINCT FROM 0
        OR version.overage_policy IS DISTINCT FROM 'deny'
        OR version.effective_from IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'callable canonical subscription remains outside Token-only contract'
      USING ERRCODE = '23514',
            CONSTRAINT = 'token_only_cutover_completion_check';
  END IF;
END;
$$;
