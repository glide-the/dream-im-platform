-- Append-only Token ledger for Token-only subscription allowance movements.
-- This table is deliberately separate from billing_ledger_entries: it never
-- stores or implies a monetary charge or payment event.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM gateway_requests
    WHERE subscription_coverage_mode = 'token_allowance'
  ) THEN
    RAISE EXCEPTION 'existing Token-covered Gateway requests require an operator-reviewed Token ledger backfill'
      USING ERRCODE = '23514',
            CONSTRAINT = 'subscription_token_ledger_backfill_required';
  END IF;
END;
$$;
--> statement-breakpoint
CREATE TABLE "subscription_token_ledger_entries" (
  "id" text PRIMARY KEY NOT NULL,
  "platform_user_id" text NOT NULL,
  "subscription_id" text NOT NULL,
  "plan_version_id" text NOT NULL,
  "subscription_allowance_id" text NOT NULL,
  "gateway_request_id" text NOT NULL,
  "request_sequence" integer NOT NULL,
  "entry_type" text NOT NULL,
  "unit" text DEFAULT 'tokens' NOT NULL,
  "amount_tokens" bigint NOT NULL,
  "available_before_tokens" bigint NOT NULL,
  "available_after_tokens" bigint NOT NULL,
  "reserved_before_tokens" bigint NOT NULL,
  "reserved_after_tokens" bigint NOT NULL,
  "consumed_before_tokens" bigint NOT NULL,
  "consumed_after_tokens" bigint NOT NULL,
  "idempotency_key" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscription_token_ledger_platform_user_fk"
    FOREIGN KEY ("platform_user_id") REFERENCES "platform_users"("id")
    ON DELETE restrict,
  CONSTRAINT "subscription_token_ledger_subscription_fk"
    FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id")
    ON DELETE restrict,
  CONSTRAINT "subscription_token_ledger_plan_version_fk"
    FOREIGN KEY ("plan_version_id") REFERENCES "subscription_plan_versions"("id")
    ON DELETE restrict,
  CONSTRAINT "subscription_token_ledger_allowance_fk"
    FOREIGN KEY ("subscription_allowance_id") REFERENCES "subscription_usage_allowances"("id")
    ON DELETE restrict,
  CONSTRAINT "subscription_token_ledger_request_fk"
    FOREIGN KEY ("gateway_request_id") REFERENCES "gateway_requests"("id")
    ON DELETE restrict,
  CONSTRAINT "subscription_token_ledger_type_check"
    CHECK ("entry_type" IN ('reserve', 'capture', 'release', 'refund', 'reversal')),
  CONSTRAINT "subscription_token_ledger_unit_check"
    CHECK ("unit" = 'tokens'),
  CONSTRAINT "subscription_token_ledger_amount_check"
    CHECK ("amount_tokens" > 0),
  CONSTRAINT "subscription_token_ledger_request_sequence_check"
    CHECK ("request_sequence" > 0),
  CONSTRAINT "subscription_token_ledger_idempotency_key_check"
    CHECK (length("idempotency_key") BETWEEN 1 AND 200),
  CONSTRAINT "subscription_token_ledger_actor_type_check"
    CHECK ("actor_type" IN ('gateway', 'system', 'admin')),
  CONSTRAINT "subscription_token_ledger_metadata_object_check"
    CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "subscription_token_ledger_state_nonnegative_check"
    CHECK (
      "available_before_tokens" >= 0
      AND "available_after_tokens" >= 0
      AND "reserved_before_tokens" >= 0
      AND "reserved_after_tokens" >= 0
      AND "consumed_before_tokens" >= 0
      AND "consumed_after_tokens" >= 0
    ),
  CONSTRAINT "subscription_token_ledger_state_conservation_check"
    CHECK (
      "available_before_tokens" + "reserved_before_tokens" + "consumed_before_tokens"
      = "available_after_tokens" + "reserved_after_tokens" + "consumed_after_tokens"
    ),
  CONSTRAINT "subscription_token_ledger_transition_check"
    CHECK (
      (
        "entry_type" = 'reserve'
        AND "available_after_tokens" = "available_before_tokens" - "amount_tokens"
        AND "reserved_after_tokens" = "reserved_before_tokens" + "amount_tokens"
        AND "consumed_after_tokens" = "consumed_before_tokens"
      )
      OR (
        "entry_type" = 'capture'
        AND "consumed_after_tokens" = "consumed_before_tokens" + "amount_tokens"
        AND "reserved_after_tokens" <= "reserved_before_tokens"
        AND "available_after_tokens" <= "available_before_tokens"
      )
      OR (
        "entry_type" = 'release'
        AND "available_after_tokens" = "available_before_tokens" + "amount_tokens"
        AND "reserved_after_tokens" = "reserved_before_tokens" - "amount_tokens"
        AND "consumed_after_tokens" = "consumed_before_tokens"
      )
      OR (
        "entry_type" IN ('refund', 'reversal')
        AND "available_after_tokens" = "available_before_tokens" + "amount_tokens"
        AND "reserved_after_tokens" = "reserved_before_tokens"
        AND "consumed_after_tokens" = "consumed_before_tokens" - "amount_tokens"
      )
    )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_token_ledger_idempotency_uidx"
ON "subscription_token_ledger_entries" ("idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_token_ledger_request_sequence_uidx"
ON "subscription_token_ledger_entries" ("gateway_request_id", "request_sequence");
--> statement-breakpoint
CREATE INDEX "subscription_token_ledger_allowance_created_idx"
ON "subscription_token_ledger_entries" ("subscription_allowance_id", "created_at");
--> statement-breakpoint
CREATE INDEX "subscription_token_ledger_request_idx"
ON "subscription_token_ledger_entries" ("gateway_request_id");
--> statement-breakpoint
CREATE INDEX "subscription_token_ledger_subscription_created_idx"
ON "subscription_token_ledger_entries" ("subscription_id", "created_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION assert_subscription_token_ledger_provenance()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.subscriptions AS subscription
    JOIN public.subscription_usage_allowances AS allowance
      ON allowance.id = NEW.subscription_allowance_id
     AND allowance.subscription_id = subscription.id
     AND allowance.plan_version_id = NEW.plan_version_id
    JOIN public.gateway_requests AS request
      ON request.id = NEW.gateway_request_id
    WHERE subscription.id = NEW.subscription_id
      AND subscription.platform_user_id = NEW.platform_user_id
      AND subscription.plan_version_id = NEW.plan_version_id
      AND request.platform_user_id = NEW.platform_user_id
      AND request.subscription_id = NEW.subscription_id
      AND request.subscription_plan_version_id = NEW.plan_version_id
      AND request.subscription_allowance_id = NEW.subscription_allowance_id
      AND request.subscription_coverage_mode = 'token_allowance'
  ) THEN
    RAISE EXCEPTION 'subscription Token ledger provenance does not match its request and allowance'
      USING ERRCODE = '23503',
            CONSTRAINT = 'subscription_token_ledger_provenance_fk';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_token_ledger_provenance
BEFORE INSERT ON "subscription_token_ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION assert_subscription_token_ledger_provenance();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_subscription_token_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'subscription Token ledger entries are append-only'
    USING ERRCODE = '55000',
          CONSTRAINT = 'subscription_token_ledger_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_token_ledger_no_update
BEFORE UPDATE ON "subscription_token_ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION prevent_subscription_token_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER subscription_token_ledger_no_delete
BEFORE DELETE ON "subscription_token_ledger_entries"
FOR EACH ROW
EXECUTE FUNCTION prevent_subscription_token_ledger_mutation();
--> statement-breakpoint
COMMENT ON TABLE "subscription_token_ledger_entries" IS
  'Append-only Token-unit audit trail for subscription allowance reserve, capture, release and reversal; never a payment ledger.';
