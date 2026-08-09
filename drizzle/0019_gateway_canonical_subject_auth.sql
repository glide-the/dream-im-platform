-- Gateway keys remain hash-only at rest. Fixed-user keys preserve the legacy
-- contract, while canonical-subject keys authenticate one trusted Dream
-- service and resolve the end user from a short-lived, per-request JWT.
ALTER TABLE "gateway_api_keys"
  ADD COLUMN "subject_mode" text DEFAULT 'fixed_user' NOT NULL;
--> statement-breakpoint
ALTER TABLE "gateway_api_keys"
  ADD COLUMN "service_client_id" text;
--> statement-breakpoint
ALTER TABLE "gateway_api_keys"
  ALTER COLUMN "platform_user_id" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "gateway_api_keys"
  ADD CONSTRAINT "gateway_api_keys_subject_check"
  CHECK (
    (
      "subject_mode" = 'fixed_user'
      AND "platform_user_id" IS NOT NULL
      AND "service_client_id" IS NULL
    )
    OR
    (
      "subject_mode" = 'canonical_subject'
      AND "platform_user_id" IS NULL
      AND "service_client_id" IS NOT NULL
      AND length(btrim("service_client_id")) BETWEEN 1 AND 160
    )
  );
--> statement-breakpoint
CREATE UNIQUE INDEX "gateway_api_keys_service_client_uidx"
  ON "gateway_api_keys" USING btree ("service_client_id")
  WHERE "subject_mode" = 'canonical_subject' AND "revoked_at" IS NULL;
--> statement-breakpoint
COMMENT ON COLUMN "gateway_api_keys"."subject_mode" IS
  'fixed_user binds the key to one legacy platform projection; canonical_subject requires a signed per-request canonical user JWT.';
--> statement-breakpoint
COMMENT ON COLUMN "gateway_api_keys"."service_client_id" IS
  'Public service identity matched against JWT client_id/azp; never contains key material.';
