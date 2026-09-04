-- [Input] Existing PostgreSQL ai_providers rows and the static credential lifecycle schema.
-- [Output] Revisioned, non-secret validation metadata with existing rows initialized unverified at revision 1.
-- [Pos] Forward-only expand migration for Provider static credential validation; no credential data is rewritten.
-- [Sync] 2026-09-04: add auth revision and exact unverified/valid validation state.

ALTER TABLE "ai_providers" ADD COLUMN "auth_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "credential_validation_status" text DEFAULT 'unverified' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "credential_validated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_auth_revision_check" CHECK ("ai_providers"."auth_revision" >= 1);--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_credential_validation_status_check" CHECK ("ai_providers"."credential_validation_status" IN ('unverified', 'valid'));--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_credential_validation_timestamp_check" CHECK (("ai_providers"."credential_validation_status" = 'unverified' AND "ai_providers"."credential_validated_at" IS NULL)
          OR ("ai_providers"."credential_validation_status" = 'valid' AND "ai_providers"."credential_validated_at" IS NOT NULL));
