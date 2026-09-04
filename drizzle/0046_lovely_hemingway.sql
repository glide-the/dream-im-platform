-- [Input] 0045 Provider adapter auth state, managed credential/attempt envelopes, and Gateway auth snapshots.
-- [Output] Durable Provider-specific revocation jobs with encrypted payload retention, lease CAS, and terminal secret erasure.
-- [Pos] Forward-only PostgreSQL 0046 revocation outbox; deliberately not a generic job framework.
-- [Sync] 2026-09-04: add fenced credential/attempt revocation work, including renewal-CAS orphan grants.

CREATE TABLE "ai_provider_revocation_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"adapter_kind" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_record_id" text NOT NULL,
	"source_record_revision" integer NOT NULL,
	"source_auth_epoch" integer NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"operation_lease_id" text,
	"operation_lease_expires_at" timestamp with time zone,
	"bundle_format_version" integer,
	"bundle_key_id" text,
	"bundle_ciphertext" text,
	"bundle_nonce" text,
	"bundle_tag" text,
	"registration_fingerprint" text NOT NULL,
	"failure_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_revocation_jobs_adapter_kind_check" CHECK ("ai_provider_revocation_jobs"."adapter_kind" IN ('codex', 'xai', 'github_copilot')),
	CONSTRAINT "ai_provider_revocation_jobs_source_kind_check" CHECK ("ai_provider_revocation_jobs"."source_kind" IN ('credential', 'attempt')),
	CONSTRAINT "ai_provider_revocation_jobs_reason_check" CHECK ("ai_provider_revocation_jobs"."reason" IN ('disconnect', 'replacement', 'activation_rejected', 'renewal_rejected')),
	CONSTRAINT "ai_provider_revocation_jobs_status_check" CHECK ("ai_provider_revocation_jobs"."status" IN ('pending', 'processing', 'succeeded', 'failed', 'unsupported')),
	CONSTRAINT "ai_provider_revocation_jobs_revision_check" CHECK ("ai_provider_revocation_jobs"."source_record_revision" >= 1
          AND "ai_provider_revocation_jobs"."source_auth_epoch" >= 1
          AND "ai_provider_revocation_jobs"."revision" >= 1
          AND "ai_provider_revocation_jobs"."attempt_count" >= 0),
	CONSTRAINT "ai_provider_revocation_jobs_registration_fingerprint_check" CHECK (btrim("ai_provider_revocation_jobs"."registration_fingerprint") <> ''),
	CONSTRAINT "ai_provider_revocation_jobs_bundle_shape_check" CHECK (("ai_provider_revocation_jobs"."bundle_format_version" IS NULL
            AND "ai_provider_revocation_jobs"."bundle_key_id" IS NULL
            AND "ai_provider_revocation_jobs"."bundle_ciphertext" IS NULL
            AND "ai_provider_revocation_jobs"."bundle_nonce" IS NULL
            AND "ai_provider_revocation_jobs"."bundle_tag" IS NULL)
          OR ("ai_provider_revocation_jobs"."bundle_format_version" >= 1
            AND "ai_provider_revocation_jobs"."bundle_key_id" IS NOT NULL
            AND "ai_provider_revocation_jobs"."bundle_ciphertext" IS NOT NULL
            AND "ai_provider_revocation_jobs"."bundle_nonce" IS NOT NULL
            AND "ai_provider_revocation_jobs"."bundle_tag" IS NOT NULL)),
	CONSTRAINT "ai_provider_revocation_jobs_secret_lifecycle_check" CHECK (("ai_provider_revocation_jobs"."status" IN ('pending', 'processing', 'failed')
            AND "ai_provider_revocation_jobs"."bundle_format_version" IS NOT NULL)
          OR ("ai_provider_revocation_jobs"."status" IN ('succeeded', 'unsupported')
            AND "ai_provider_revocation_jobs"."bundle_format_version" IS NULL)),
	CONSTRAINT "ai_provider_revocation_jobs_schedule_check" CHECK (("ai_provider_revocation_jobs"."status" IN ('pending', 'failed')
            AND "ai_provider_revocation_jobs"."next_attempt_at" IS NOT NULL)
          OR ("ai_provider_revocation_jobs"."status" IN ('processing', 'succeeded', 'unsupported')
            AND "ai_provider_revocation_jobs"."next_attempt_at" IS NULL)),
	CONSTRAINT "ai_provider_revocation_jobs_lease_check" CHECK (("ai_provider_revocation_jobs"."status" = 'processing'
            AND "ai_provider_revocation_jobs"."operation_lease_id" IS NOT NULL
            AND "ai_provider_revocation_jobs"."operation_lease_expires_at" IS NOT NULL)
          OR ("ai_provider_revocation_jobs"."status" <> 'processing'
            AND "ai_provider_revocation_jobs"."operation_lease_id" IS NULL
            AND "ai_provider_revocation_jobs"."operation_lease_expires_at" IS NULL)),
	CONSTRAINT "ai_provider_revocation_jobs_failure_check" CHECK (("ai_provider_revocation_jobs"."status" = 'failed' AND "ai_provider_revocation_jobs"."failure_code" IS NOT NULL)
          OR ("ai_provider_revocation_jobs"."status" <> 'failed' AND "ai_provider_revocation_jobs"."failure_code" IS NULL)),
	CONSTRAINT "ai_provider_revocation_jobs_completion_check" CHECK (("ai_provider_revocation_jobs"."status" IN ('succeeded', 'unsupported')
            AND "ai_provider_revocation_jobs"."completed_at" IS NOT NULL
            AND "ai_provider_revocation_jobs"."completed_at" >= "ai_provider_revocation_jobs"."created_at")
          OR ("ai_provider_revocation_jobs"."status" IN ('pending', 'processing', 'failed')
            AND "ai_provider_revocation_jobs"."completed_at" IS NULL)),
	CONSTRAINT "ai_provider_revocation_jobs_attempt_count_check" CHECK ("ai_provider_revocation_jobs"."status" = 'pending'
          OR "ai_provider_revocation_jobs"."status" = 'unsupported'
          OR "ai_provider_revocation_jobs"."attempt_count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ADD CONSTRAINT "ai_provider_revocation_jobs_provider_adapter_fk" FOREIGN KEY ("provider_id","adapter_kind") REFERENCES "public"."ai_providers"("id","adapter_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_revocation_jobs_source_uidx" ON "ai_provider_revocation_jobs" USING btree ("provider_id","source_kind","source_record_id","source_record_revision","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_revocation_jobs_processing_provider_uidx" ON "ai_provider_revocation_jobs" USING btree ("provider_id") WHERE "ai_provider_revocation_jobs"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "ai_provider_revocation_jobs_schedule_idx" ON "ai_provider_revocation_jobs" USING btree ("status","next_attempt_at");
