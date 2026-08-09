DROP TRIGGER IF EXISTS subscription_plan_versions_token_only ON "subscription_plan_versions";
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enforce_token_only_subscription_plan_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.billing_period IS DISTINCT FROM 'monthly'
     OR NEW.base_price_microusd < 0
     OR NEW.allowance_microusd IS DISTINCT FROM 0
     OR NEW.overage_policy IS DISTINCT FROM 'deny'
     OR NEW.effective_from IS NOT NULL THEN
    RAISE EXCEPTION 'subscription plan versions are monthly token allowances with an optional non-negative monthly price'
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
COMMENT ON COLUMN "subscription_plan_versions"."base_price_microusd" IS
  'Immutable monthly subscription price in integer micro-USD. It never grants monetary allowance and is not the Token ledger unit.';
--> statement-breakpoint
CREATE TABLE "subscription_payment_intents" (
  "id" text PRIMARY KEY NOT NULL,
  "platform_user_id" text NOT NULL,
  "plan_version_id" text NOT NULL,
  "subscription_id" text,
  "adapter_code" text NOT NULL,
  "external_intent_id" text,
  "amount_microusd" bigint NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "status" text DEFAULT 'creating' NOT NULL,
  "idempotency_key" text NOT NULL,
  "client_id" text NOT NULL,
  "next_action" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "failure_code" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "succeeded_at" timestamp with time zone,
  CONSTRAINT "subscription_payment_intents_user_fk" FOREIGN KEY ("platform_user_id") REFERENCES "public"."platform_users"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "subscription_payment_intents_version_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."subscription_plan_versions"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "subscription_payment_intents_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "subscription_payment_intents_amount_check" CHECK ("amount_microusd" > 0),
  CONSTRAINT "subscription_payment_intents_currency_check" CHECK ("currency" = 'USD'),
  CONSTRAINT "subscription_payment_intents_status_check" CHECK ("status" IN ('creating', 'requires_action', 'processing', 'succeeded', 'failed', 'cancelled', 'refunded', 'reversed')),
  CONSTRAINT "subscription_payment_intents_next_action_check" CHECK (jsonb_typeof("next_action") = 'object'),
  CONSTRAINT "subscription_payment_intents_idempotency_check" CHECK (length("idempotency_key") BETWEEN 8 AND 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_intents_user_idempotency_uidx"
ON "subscription_payment_intents" ("platform_user_id", "idempotency_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_intents_external_uidx"
ON "subscription_payment_intents" ("adapter_code", "external_intent_id")
WHERE "external_intent_id" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "subscription_payment_intents_user_created_idx"
ON "subscription_payment_intents" ("platform_user_id", "created_at");
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
  "id" text PRIMARY KEY NOT NULL,
  "adapter_code" text NOT NULL,
  "external_event_id" text NOT NULL,
  "event_type" text NOT NULL,
  "payment_intent_id" text,
  "payload_sha256" text NOT NULL,
  "payload_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "signature_verified" boolean DEFAULT false NOT NULL,
  "processing_status" text DEFAULT 'received' NOT NULL,
  "error_code" text,
  "received_at" timestamp with time zone DEFAULT now() NOT NULL,
  "processed_at" timestamp with time zone,
  CONSTRAINT "payment_webhook_events_intent_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."subscription_payment_intents"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "payment_webhook_events_sha_check" CHECK ("payload_sha256" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "payment_webhook_events_summary_check" CHECK (jsonb_typeof("payload_summary") = 'object'),
  CONSTRAINT "payment_webhook_events_status_check" CHECK ("processing_status" IN ('received', 'processed', 'rejected', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "payment_webhook_events_external_uidx"
ON "payment_webhook_events" ("adapter_code", "external_event_id");
--> statement-breakpoint
CREATE INDEX "payment_webhook_events_intent_received_idx"
ON "payment_webhook_events" ("payment_intent_id", "received_at");
--> statement-breakpoint
CREATE TABLE "subscription_payment_adjustments" (
  "id" text PRIMARY KEY NOT NULL,
  "payment_intent_id" text NOT NULL,
  "adjustment_type" text NOT NULL,
  "amount_microusd" bigint NOT NULL,
  "status" text NOT NULL,
  "external_adjustment_id" text,
  "idempotency_key" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "subscription_payment_adjustments_intent_fk" FOREIGN KEY ("payment_intent_id") REFERENCES "public"."subscription_payment_intents"("id") ON DELETE restrict ON UPDATE no action,
  CONSTRAINT "subscription_payment_adjustments_type_check" CHECK ("adjustment_type" IN ('refund', 'reversal')),
  CONSTRAINT "subscription_payment_adjustments_amount_check" CHECK ("amount_microusd" > 0),
  CONSTRAINT "subscription_payment_adjustments_status_check" CHECK ("status" IN ('pending', 'succeeded', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_adjustments_idempotency_uidx"
ON "subscription_payment_adjustments" ("idempotency_key");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_payment_adjustment_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'subscription_payment_adjustments is append-only'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER subscription_payment_adjustments_no_update
BEFORE UPDATE ON "subscription_payment_adjustments"
FOR EACH ROW EXECUTE FUNCTION prevent_payment_adjustment_mutation();
--> statement-breakpoint
CREATE TRIGGER subscription_payment_adjustments_no_delete
BEFORE DELETE ON "subscription_payment_adjustments"
FOR EACH ROW EXECUTE FUNCTION prevent_payment_adjustment_mutation();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION protect_payment_webhook_facts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.adapter_code IS DISTINCT FROM OLD.adapter_code
     OR NEW.external_event_id IS DISTINCT FROM OLD.external_event_id
     OR NEW.event_type IS DISTINCT FROM OLD.event_type
     OR NEW.payload_sha256 IS DISTINCT FROM OLD.payload_sha256
     OR NEW.payload_summary IS DISTINCT FROM OLD.payload_summary
     OR NEW.signature_verified IS DISTINCT FROM OLD.signature_verified
     OR NEW.received_at IS DISTINCT FROM OLD.received_at THEN
    RAISE EXCEPTION 'payment webhook facts are immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_webhook_events_protect_facts
BEFORE UPDATE ON "payment_webhook_events"
FOR EACH ROW EXECUTE FUNCTION protect_payment_webhook_facts();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION prevent_payment_webhook_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'payment_webhook_events cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER payment_webhook_events_no_delete
BEFORE DELETE ON "payment_webhook_events"
FOR EACH ROW EXECUTE FUNCTION prevent_payment_webhook_delete();
