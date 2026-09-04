-- [Input] 0045/0046 Provider-owned managed credentials plus the explicit account cutover runner.
-- [Output] Additive product-account columns, Provider binding/default relations, and account fences.
-- [Pos] Forward-only PostgreSQL 0047 expand; old ownership constraints remain until the audited contract migration.
-- [Sync] 2026-09-04: expand managed auth without selecting a product default or rewriting secret payloads in DDL.

CREATE TABLE "ai_provider_managed_account_defaults" (
	"adapter_kind" text PRIMARY KEY NOT NULL,
	"credential_id" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_provider_managed_account_defaults_adapter_kind_check" CHECK ("ai_provider_managed_account_defaults"."adapter_kind" IN ('codex', 'xai', 'github_copilot')),
	CONSTRAINT "ai_provider_managed_account_defaults_revision_check" CHECK ("ai_provider_managed_account_defaults"."revision" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" DROP CONSTRAINT "ai_provider_managed_credentials_revision_check";--> statement-breakpoint
ALTER TABLE "gateway_requests" DROP CONSTRAINT "gateway_requests_provider_auth_snapshot_check";--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD COLUMN "target_credential_id" text;--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD COLUMN "expected_credential_auth_epoch" integer;--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD COLUMN "expected_credential_revision" integer;--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD COLUMN "envelope_context_id" text;--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ADD COLUMN "auth_epoch" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ADD COLUMN "display_name" text;--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ADD COLUMN "envelope_context_id" text;--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ADD COLUMN "managed_credential_id" text;--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ADD COLUMN "account_scope_id" text;--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ADD COLUMN "credential_auth_epoch" integer;--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ADD COLUMN "envelope_context_id" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "managed_account_binding_mode" text;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD COLUMN "managed_credential_id" text;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "provider_managed_credential_id" text;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "provider_managed_account_auth_epoch" integer;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD COLUMN "provider_managed_default_revision" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_managed_credentials_id_adapter_uidx" ON "ai_provider_managed_credentials" USING btree ("id","adapter_kind");--> statement-breakpoint
ALTER TABLE "ai_provider_managed_account_defaults" ADD CONSTRAINT "ai_provider_managed_account_defaults_credential_adapter_fk" FOREIGN KEY ("credential_id","adapter_kind") REFERENCES "public"."ai_provider_managed_credentials"("id","adapter_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD CONSTRAINT "ai_provider_auth_attempts_target_credential_adapter_fk" FOREIGN KEY ("target_credential_id","adapter_kind") REFERENCES "public"."ai_provider_managed_credentials"("id","adapter_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ADD CONSTRAINT "ai_provider_revocation_jobs_credential_adapter_fk" FOREIGN KEY ("managed_credential_id","adapter_kind") REFERENCES "public"."ai_provider_managed_credentials"("id","adapter_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_managed_credential_adapter_fk" FOREIGN KEY ("managed_credential_id","adapter_kind") REFERENCES "public"."ai_provider_managed_credentials"("id","adapter_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_managed_credential_adapter_fk" FOREIGN KEY ("provider_managed_credential_id","provider_adapter_kind") REFERENCES "public"."ai_provider_managed_credentials"("id","adapter_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_auth_attempts_target_active_uidx" ON "ai_provider_auth_attempts" USING btree ("target_credential_id") WHERE "ai_provider_auth_attempts"."target_credential_id" IS NOT NULL AND "ai_provider_auth_attempts"."status" IN ('starting', 'pending');--> statement-breakpoint
CREATE INDEX "ai_provider_managed_credentials_adapter_status_idx" ON "ai_provider_managed_credentials" USING btree ("adapter_kind","status");--> statement-breakpoint
CREATE INDEX "ai_provider_managed_credentials_identity_idx" ON "ai_provider_managed_credentials" USING btree ("adapter_kind","account_identity_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_revocation_jobs_account_source_uidx" ON "ai_provider_revocation_jobs" USING btree ("adapter_kind","account_scope_id","source_kind","source_record_id","source_record_revision","reason") WHERE "ai_provider_revocation_jobs"."account_scope_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_revocation_jobs_processing_account_uidx" ON "ai_provider_revocation_jobs" USING btree ("adapter_kind","account_scope_id") WHERE "ai_provider_revocation_jobs"."status" = 'processing' AND "ai_provider_revocation_jobs"."account_scope_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "ai_providers_managed_credential_idx" ON "ai_providers" USING btree ("managed_credential_id");--> statement-breakpoint
CREATE INDEX "ai_providers_managed_binding_idx" ON "ai_providers" USING btree ("adapter_kind","managed_account_binding_mode");--> statement-breakpoint
CREATE INDEX "gateway_requests_managed_credential_idx" ON "gateway_requests" USING btree ("provider_managed_credential_id","created_at");--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD CONSTRAINT "ai_provider_auth_attempts_target_fence_check" CHECK (("ai_provider_auth_attempts"."target_credential_id" IS NULL
            AND "ai_provider_auth_attempts"."expected_credential_auth_epoch" IS NULL
            AND "ai_provider_auth_attempts"."expected_credential_revision" IS NULL)
          OR ("ai_provider_auth_attempts"."target_credential_id" IS NOT NULL
            AND "ai_provider_auth_attempts"."expected_credential_auth_epoch" >= 1
            AND "ai_provider_auth_attempts"."expected_credential_revision" >= 1));--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD CONSTRAINT "ai_provider_auth_attempts_envelope_context_check" CHECK ("ai_provider_auth_attempts"."envelope_context_id" IS NULL
          OR btrim("ai_provider_auth_attempts"."envelope_context_id") <> '');--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ADD CONSTRAINT "ai_provider_managed_credentials_envelope_context_check" CHECK ("ai_provider_managed_credentials"."envelope_context_id" IS NULL
          OR btrim("ai_provider_managed_credentials"."envelope_context_id") <> '');--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ADD CONSTRAINT "ai_provider_managed_credentials_revision_check" CHECK ("ai_provider_managed_credentials"."auth_epoch" >= 1 AND "ai_provider_managed_credentials"."revision" >= 1);--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ADD CONSTRAINT "ai_provider_revocation_jobs_account_scope_check" CHECK (("ai_provider_revocation_jobs"."account_scope_id" IS NULL
            AND "ai_provider_revocation_jobs"."managed_credential_id" IS NULL
            AND "ai_provider_revocation_jobs"."credential_auth_epoch" IS NULL
            AND "ai_provider_revocation_jobs"."envelope_context_id" IS NULL)
          OR ("ai_provider_revocation_jobs"."account_scope_id" IS NOT NULL
            AND btrim("ai_provider_revocation_jobs"."account_scope_id") <> ''
            AND "ai_provider_revocation_jobs"."envelope_context_id" IS NOT NULL
            AND btrim("ai_provider_revocation_jobs"."envelope_context_id") <> ''
            AND ("ai_provider_revocation_jobs"."credential_auth_epoch" IS NULL
              OR "ai_provider_revocation_jobs"."credential_auth_epoch" >= 1)));--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_managed_account_binding_check" CHECK (("ai_providers"."adapter_kind" = 'generic'
            AND "ai_providers"."managed_account_binding_mode" IS NULL
            AND "ai_providers"."managed_credential_id" IS NULL)
          OR ("ai_providers"."adapter_kind" IN ('codex', 'xai', 'github_copilot')
            AND (
              ("ai_providers"."managed_account_binding_mode" IS NULL
                AND "ai_providers"."managed_credential_id" IS NULL)
              OR ("ai_providers"."managed_account_binding_mode" = 'follow_default'
                AND "ai_providers"."managed_credential_id" IS NULL)
              OR ("ai_providers"."managed_account_binding_mode" = 'pinned'
                AND "ai_providers"."managed_credential_id" IS NOT NULL)
            )));--> statement-breakpoint
ALTER TABLE "gateway_requests" ADD CONSTRAINT "gateway_requests_provider_auth_snapshot_check" CHECK ("gateway_requests"."provider_auth_epoch" >= 1
          AND "gateway_requests"."provider_credential_revision" >= 1
          AND (
            ("gateway_requests"."provider_managed_credential_id" IS NULL
              AND "gateway_requests"."provider_managed_account_auth_epoch" IS NULL
              AND "gateway_requests"."provider_managed_default_revision" IS NULL)
            OR ("gateway_requests"."provider_managed_credential_id" IS NOT NULL
              AND "gateway_requests"."provider_managed_account_auth_epoch" >= 1
              AND ("gateway_requests"."provider_managed_default_revision" IS NULL
                OR "gateway_requests"."provider_managed_default_revision" >= 1))
          ));--> statement-breakpoint
INSERT INTO "drizzle"."data_migration_definitions" (
  "migration_key", "owner", "runner_contract", "runner_path",
  "expected_table_count", "expected_source_row_count", "metadata"
) VALUES (
  'provider-managed-accounts-v1',
  'admin',
  'ink-admin-provider-managed-accounts-v1',
  'drizzle/data/provider-managed-accounts.ts',
  4,
  NULL,
  '{"tables":["ai_providers","ai_provider_managed_credentials","ai_provider_auth_attempts","ai_provider_revocation_jobs"],"defaultSelection":"explicit-only","secretTransform":"transactional-aad-reencryption","defaultMode":"dry-run"}'::jsonb
);
