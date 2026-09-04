-- [Input] 0044 Provider credential lifecycle rows plus existing Gateway request history.
-- [Output] Fenced product-adapter auth state, encrypted managed credential/attempt storage, and non-secret request auth snapshots.
-- [Pos] Forward-only PostgreSQL expand migration for managed Provider authentication; token material remains application-encrypted.
-- [Sync] 2026-09-04: add Codex/xAI/GitHub Copilot auth persistence without rewriting static API keys or historical requests.

CREATE TABLE "ai_provider_auth_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"adapter_kind" text NOT NULL,
	"flow_kind" text NOT NULL,
	"status" text DEFAULT 'starting' NOT NULL,
	"expected_auth_epoch" integer NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"idempotency_key_hash" text NOT NULL,
	"request_canonical_hash" text NOT NULL,
	"registration_fingerprint" text NOT NULL,
	"state_hash" text,
	"bundle_format_version" integer,
	"bundle_key_id" text,
	"bundle_ciphertext" text,
	"bundle_nonce" text,
	"bundle_tag" text,
	"redirect_uri" text,
	"verification_uri" text,
	"expires_at" timestamp with time zone,
	"poll_interval_seconds" integer,
	"next_poll_at" timestamp with time zone,
	"operation_lease_id" text,
	"operation_lease_expires_at" timestamp with time zone,
	"failure_code" text,
	"consumed_at" timestamp with time zone,
	"created_by_admin_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_auth_attempts_adapter_kind_check" CHECK ("ai_provider_auth_attempts"."adapter_kind" IN ('codex', 'xai', 'github_copilot')),
	CONSTRAINT "ai_provider_auth_attempts_flow_kind_check" CHECK ("ai_provider_auth_attempts"."flow_kind" = 'device_code'),
	CONSTRAINT "ai_provider_auth_attempts_status_check" CHECK ("ai_provider_auth_attempts"."status" IN ('starting', 'pending', 'succeeded', 'denied', 'expired', 'cancelled', 'failed')),
	CONSTRAINT "ai_provider_auth_attempts_epoch_revision_check" CHECK ("ai_provider_auth_attempts"."expected_auth_epoch" >= 1 AND "ai_provider_auth_attempts"."revision" >= 1),
	CONSTRAINT "ai_provider_auth_attempts_bundle_shape_check" CHECK (("ai_provider_auth_attempts"."bundle_format_version" IS NULL
            AND "ai_provider_auth_attempts"."bundle_key_id" IS NULL
            AND "ai_provider_auth_attempts"."bundle_ciphertext" IS NULL
            AND "ai_provider_auth_attempts"."bundle_nonce" IS NULL
            AND "ai_provider_auth_attempts"."bundle_tag" IS NULL)
          OR ("ai_provider_auth_attempts"."bundle_format_version" >= 1
            AND "ai_provider_auth_attempts"."bundle_key_id" IS NOT NULL
            AND "ai_provider_auth_attempts"."bundle_ciphertext" IS NOT NULL
            AND "ai_provider_auth_attempts"."bundle_nonce" IS NOT NULL
            AND "ai_provider_auth_attempts"."bundle_tag" IS NOT NULL)),
	CONSTRAINT "ai_provider_auth_attempts_active_bundle_check" CHECK (("ai_provider_auth_attempts"."status" = 'starting'
            AND "ai_provider_auth_attempts"."bundle_format_version" IS NULL)
          OR ("ai_provider_auth_attempts"."status" = 'pending'
            AND "ai_provider_auth_attempts"."bundle_format_version" IS NOT NULL)
          OR ("ai_provider_auth_attempts"."status" IN ('succeeded', 'denied', 'expired', 'cancelled', 'failed')
            AND "ai_provider_auth_attempts"."bundle_format_version" IS NULL)),
	CONSTRAINT "ai_provider_auth_attempts_flow_shape_check" CHECK (("ai_provider_auth_attempts"."status" = 'starting'
            AND "ai_provider_auth_attempts"."state_hash" IS NULL
            AND "ai_provider_auth_attempts"."redirect_uri" IS NULL
            AND "ai_provider_auth_attempts"."verification_uri" IS NULL
            AND "ai_provider_auth_attempts"."expires_at" IS NULL
            AND "ai_provider_auth_attempts"."poll_interval_seconds" IS NULL
            AND "ai_provider_auth_attempts"."next_poll_at" IS NULL)
          OR ("ai_provider_auth_attempts"."status" <> 'starting'
            AND "ai_provider_auth_attempts"."state_hash" IS NULL
            AND "ai_provider_auth_attempts"."redirect_uri" IS NULL
            AND "ai_provider_auth_attempts"."verification_uri" IS NOT NULL
            AND "ai_provider_auth_attempts"."expires_at" IS NOT NULL
            AND "ai_provider_auth_attempts"."poll_interval_seconds" > 0
            AND "ai_provider_auth_attempts"."next_poll_at" IS NOT NULL)
          OR ("ai_provider_auth_attempts"."status" IN ('succeeded', 'denied', 'expired', 'cancelled', 'failed')
            AND "ai_provider_auth_attempts"."state_hash" IS NULL
            AND "ai_provider_auth_attempts"."redirect_uri" IS NULL
            AND "ai_provider_auth_attempts"."verification_uri" IS NULL
            AND "ai_provider_auth_attempts"."expires_at" IS NULL
            AND "ai_provider_auth_attempts"."poll_interval_seconds" IS NULL
            AND "ai_provider_auth_attempts"."next_poll_at" IS NULL)),
	CONSTRAINT "ai_provider_auth_attempts_operation_lease_check" CHECK (("ai_provider_auth_attempts"."operation_lease_id" IS NULL AND "ai_provider_auth_attempts"."operation_lease_expires_at" IS NULL)
          OR ("ai_provider_auth_attempts"."status" IN ('starting', 'pending')
            AND "ai_provider_auth_attempts"."operation_lease_id" IS NOT NULL
            AND "ai_provider_auth_attempts"."operation_lease_expires_at" IS NOT NULL)),
	CONSTRAINT "ai_provider_auth_attempts_consumed_check" CHECK (("ai_provider_auth_attempts"."status" IN ('starting', 'pending') AND "ai_provider_auth_attempts"."consumed_at" IS NULL)
          OR ("ai_provider_auth_attempts"."status" IN ('succeeded', 'denied', 'expired', 'cancelled', 'failed') AND "ai_provider_auth_attempts"."consumed_at" IS NOT NULL)),
	CONSTRAINT "ai_provider_auth_attempts_failure_check" CHECK ("ai_provider_auth_attempts"."status" <> 'failed' OR "ai_provider_auth_attempts"."failure_code" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "ai_provider_managed_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"adapter_kind" text NOT NULL,
	"status" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"bundle_format_version" integer,
	"bundle_key_id" text,
	"bundle_ciphertext" text,
	"bundle_nonce" text,
	"bundle_tag" text,
	"registration_fingerprint" text NOT NULL,
	"account_identity_hash" text,
	"account_label" text,
	"granted_scopes" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"access_expires_at" timestamp with time zone,
	"refresh_expires_at" timestamp with time zone,
	"session_expires_at" timestamp with time zone,
	"refresh_lease_id" text,
	"refresh_lease_expires_at" timestamp with time zone,
	"revocation_status" text,
	"revocation_attempted_at" timestamp with time zone,
	"revocation_completed_at" timestamp with time zone,
	"revocation_failure_code" text,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_managed_credentials_adapter_kind_check" CHECK ("ai_provider_managed_credentials"."adapter_kind" IN ('codex', 'xai', 'github_copilot')),
	CONSTRAINT "ai_provider_managed_credentials_status_check" CHECK ("ai_provider_managed_credentials"."status" IN ('connected', 'reauth_required', 'disconnected')),
	CONSTRAINT "ai_provider_managed_credentials_revision_check" CHECK ("ai_provider_managed_credentials"."revision" >= 1),
	CONSTRAINT "ai_provider_managed_credentials_active_bundle_check" CHECK (("ai_provider_managed_credentials"."status" = 'connected'
            AND "ai_provider_managed_credentials"."bundle_format_version" IS NOT NULL
            AND "ai_provider_managed_credentials"."bundle_key_id" IS NOT NULL
            AND "ai_provider_managed_credentials"."bundle_ciphertext" IS NOT NULL
            AND "ai_provider_managed_credentials"."bundle_nonce" IS NOT NULL
            AND "ai_provider_managed_credentials"."bundle_tag" IS NOT NULL)
          OR "ai_provider_managed_credentials"."status" = 'reauth_required'
          OR ("ai_provider_managed_credentials"."status" = 'disconnected'
            AND "ai_provider_managed_credentials"."bundle_format_version" IS NULL)),
	CONSTRAINT "ai_provider_managed_credentials_bundle_shape_check" CHECK (("ai_provider_managed_credentials"."bundle_format_version" IS NULL
            AND "ai_provider_managed_credentials"."bundle_key_id" IS NULL
            AND "ai_provider_managed_credentials"."bundle_ciphertext" IS NULL
            AND "ai_provider_managed_credentials"."bundle_nonce" IS NULL
            AND "ai_provider_managed_credentials"."bundle_tag" IS NULL)
          OR ("ai_provider_managed_credentials"."bundle_format_version" >= 1
            AND "ai_provider_managed_credentials"."bundle_key_id" IS NOT NULL
            AND "ai_provider_managed_credentials"."bundle_ciphertext" IS NOT NULL
            AND "ai_provider_managed_credentials"."bundle_nonce" IS NOT NULL
            AND "ai_provider_managed_credentials"."bundle_tag" IS NOT NULL)),
	CONSTRAINT "ai_provider_managed_credentials_refresh_lease_check" CHECK (("ai_provider_managed_credentials"."refresh_lease_id" IS NULL AND "ai_provider_managed_credentials"."refresh_lease_expires_at" IS NULL)
          OR ("ai_provider_managed_credentials"."status" = 'connected'
            AND "ai_provider_managed_credentials"."refresh_lease_id" IS NOT NULL
            AND "ai_provider_managed_credentials"."refresh_lease_expires_at" IS NOT NULL)),
	CONSTRAINT "ai_provider_managed_credentials_revocation_status_check" CHECK ("ai_provider_managed_credentials"."revocation_status" IS NULL
          OR "ai_provider_managed_credentials"."revocation_status" IN ('not_attempted', 'succeeded', 'failed', 'unsupported')),
	CONSTRAINT "ai_provider_managed_credentials_revocation_shape_check" CHECK (("ai_provider_managed_credentials"."revocation_status" IS NULL
            AND "ai_provider_managed_credentials"."revocation_attempted_at" IS NULL
            AND "ai_provider_managed_credentials"."revocation_completed_at" IS NULL
            AND "ai_provider_managed_credentials"."revocation_failure_code" IS NULL)
          OR ("ai_provider_managed_credentials"."revocation_status" IN ('not_attempted', 'unsupported')
            AND "ai_provider_managed_credentials"."revocation_attempted_at" IS NULL
            AND "ai_provider_managed_credentials"."revocation_completed_at" IS NULL
            AND "ai_provider_managed_credentials"."revocation_failure_code" IS NULL)
          OR ("ai_provider_managed_credentials"."revocation_status" = 'succeeded'
            AND "ai_provider_managed_credentials"."revocation_attempted_at" IS NOT NULL
            AND "ai_provider_managed_credentials"."revocation_completed_at" IS NOT NULL
            AND "ai_provider_managed_credentials"."revocation_failure_code" IS NULL)
          OR ("ai_provider_managed_credentials"."revocation_status" = 'failed'
            AND "ai_provider_managed_credentials"."revocation_attempted_at" IS NOT NULL
            AND "ai_provider_managed_credentials"."revocation_completed_at" IS NULL
            AND "ai_provider_managed_credentials"."revocation_failure_code" IS NOT NULL)),
	CONSTRAINT "ai_provider_managed_credentials_revocation_lifecycle_check" CHECK (("ai_provider_managed_credentials"."status" = 'disconnected'
            AND "ai_provider_managed_credentials"."disconnected_at" IS NOT NULL
            AND "ai_provider_managed_credentials"."revocation_status" IS NOT NULL)
          OR ("ai_provider_managed_credentials"."status" IN ('connected', 'reauth_required')
            AND "ai_provider_managed_credentials"."disconnected_at" IS NULL
            AND "ai_provider_managed_credentials"."revocation_status" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "ai_providers" ALTER COLUMN "base_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "adapter_kind" text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "active_credential_kind" text DEFAULT 'static_api_key' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "auth_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "provider_adapter_kind" text DEFAULT 'generic' NOT NULL;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "provider_auth_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "provider_credential_revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "provider_renewal_attempted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_providers_id_adapter_kind_uidx" ON "ai_providers" USING btree ("id","adapter_kind");--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD CONSTRAINT "ai_provider_auth_attempts_created_by_admin_id_admin_users_id_fk" FOREIGN KEY ("created_by_admin_id") REFERENCES "public"."admin_users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD CONSTRAINT "ai_provider_auth_attempts_provider_adapter_fk" FOREIGN KEY ("provider_id","adapter_kind") REFERENCES "public"."ai_providers"("id","adapter_kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ADD CONSTRAINT "ai_provider_managed_credentials_provider_adapter_fk" FOREIGN KEY ("provider_id","adapter_kind") REFERENCES "public"."ai_providers"("id","adapter_kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_auth_attempts_idempotency_uidx" ON "ai_provider_auth_attempts" USING btree ("provider_id","adapter_kind","expected_auth_epoch","idempotency_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_auth_attempts_state_uidx" ON "ai_provider_auth_attempts" USING btree ("state_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_auth_attempts_provider_active_uidx" ON "ai_provider_auth_attempts" USING btree ("provider_id") WHERE "ai_provider_auth_attempts"."status" IN ('starting', 'pending');--> statement-breakpoint
CREATE INDEX "ai_provider_auth_attempts_expiry_idx" ON "ai_provider_auth_attempts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_managed_credentials_provider_uidx" ON "ai_provider_managed_credentials" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "ai_provider_managed_credentials_refresh_idx" ON "ai_provider_managed_credentials" USING btree ("status","access_expires_at");--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_auth_epoch_check" CHECK ("ai_providers"."auth_epoch" >= 1);--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_adapter_kind_check" CHECK ("ai_providers"."adapter_kind" IN ('generic', 'codex', 'xai', 'github_copilot'));--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_active_credential_kind_check" CHECK ("ai_providers"."active_credential_kind" IN ('static_api_key', 'managed_oauth', 'none'));--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_adapter_credential_kind_check" CHECK (("ai_providers"."adapter_kind" = 'generic' AND "ai_providers"."active_credential_kind" = 'static_api_key')
          OR ("ai_providers"."adapter_kind" IN ('codex', 'xai', 'github_copilot') AND "ai_providers"."active_credential_kind" IN ('managed_oauth', 'none')));--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_adapter_base_url_check" CHECK (("ai_providers"."adapter_kind" = 'generic' AND "ai_providers"."base_url" IS NOT NULL)
          OR ("ai_providers"."adapter_kind" IN ('codex', 'xai', 'github_copilot') AND "ai_providers"."base_url" IS NULL));--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_provider_adapter_kind_check" CHECK ("gateway_requests"."provider_adapter_kind" IN ('generic', 'codex', 'xai', 'github_copilot'));--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_provider_auth_snapshot_check" CHECK ("gateway_requests"."provider_auth_epoch" >= 1 AND "gateway_requests"."provider_credential_revision" >= 1);
