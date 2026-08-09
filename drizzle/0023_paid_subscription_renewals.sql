ALTER TABLE "subscription_payment_intents"
ADD COLUMN "operation" text DEFAULT 'initial_activation' NOT NULL;
--> statement-breakpoint
ALTER TABLE "subscription_payment_intents"
ADD COLUMN "expected_subscription_version" integer;
--> statement-breakpoint
ALTER TABLE "subscription_payment_intents"
ADD COLUMN "expected_period_end" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "subscription_payment_intents"
ADD CONSTRAINT "subscription_payment_intents_operation_check"
CHECK ("operation" IN ('initial_activation', 'renewal'));
--> statement-breakpoint
ALTER TABLE "subscription_payment_intents"
ADD CONSTRAINT "subscription_payment_intents_renewal_binding_check"
CHECK (
  ("operation" = 'initial_activation'
    AND "expected_subscription_version" IS NULL
    AND "expected_period_end" IS NULL)
  OR
  ("operation" = 'renewal'
    AND "subscription_id" IS NOT NULL
    AND "expected_subscription_version" IS NOT NULL
    AND "expected_subscription_version" >= 1
    AND "expected_period_end" IS NOT NULL)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_payment_intents_live_renewal_uidx"
ON "subscription_payment_intents" ("subscription_id", "expected_period_end")
WHERE "operation" = 'renewal'
  AND "status" IN ('creating', 'requires_action', 'processing', 'succeeded');
--> statement-breakpoint
COMMENT ON COLUMN "subscription_payment_intents"."operation" IS
  'Platform operation bound to this intent. initial_activation creates the first subscription; renewal advances exactly one due personal monthly boundary.';
