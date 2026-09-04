-- [Input] 0047 expand plus a committed provider-managed-accounts-v1 data-runner receipt.
-- [Output] Product-scoped managed accounts with strict AAD scopes, identity uniqueness, and account-owned revocation leases.
-- [Pos] Forward-only PostgreSQL 0048 contract; fails closed before any destructive constraint change.
-- [Sync] 2026-09-04: validate revocation envelope AAD against account scope before retiring Provider ownership.

DO $$
DECLARE
  affected_rows bigint;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM ai_provider_auth_attempts
     WHERE status IN ('starting', 'pending')
  ) THEN
    RAISE EXCEPTION 'PROVIDER_MANAGED_ACCOUNTS_CONTRACT_BLOCKED: active auth attempts remain'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_provider_revocation_jobs
     WHERE status IN ('pending', 'processing', 'failed')
  ) THEN
    RAISE EXCEPTION 'PROVIDER_MANAGED_ACCOUNTS_CONTRACT_BLOCKED: non-terminal revocation jobs remain'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    (SELECT count(*) FROM ai_providers WHERE adapter_kind <> 'generic')
    + (SELECT count(*) FROM ai_provider_managed_credentials)
    + (SELECT count(*) FROM ai_provider_auth_attempts)
    + (SELECT count(*) FROM ai_provider_revocation_jobs)
    INTO affected_rows;

  IF affected_rows > 0 AND NOT EXISTS (
    SELECT 1
      FROM drizzle.data_migration_runs
     WHERE migration_key = 'provider-managed-accounts-v1'
       AND status = 'committed'
  ) THEN
    RAISE EXCEPTION 'PROVIDER_MANAGED_ACCOUNTS_CONTRACT_BLOCKED: run drizzle/data/provider-managed-accounts.ts --apply after 0047'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_providers
     WHERE adapter_kind IN ('codex', 'xai', 'github_copilot')
       AND (
         managed_account_binding_mode IS NULL
         OR (managed_account_binding_mode = 'pinned' AND managed_credential_id IS NULL)
         OR (managed_account_binding_mode = 'follow_default' AND managed_credential_id IS NOT NULL)
       )
  ) THEN
    RAISE EXCEPTION 'PROVIDER_MANAGED_ACCOUNTS_CONTRACT_BLOCKED: Provider bindings are incomplete'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ai_provider_managed_credentials
     WHERE envelope_context_id IS DISTINCT FROM id
  ) OR EXISTS (
    SELECT 1 FROM ai_provider_auth_attempts
     WHERE envelope_context_id IS DISTINCT FROM id
  ) OR EXISTS (
    SELECT 1 FROM ai_provider_revocation_jobs
     WHERE envelope_context_id IS DISTINCT FROM account_scope_id
        OR account_scope_id IS NULL
  ) THEN
    RAISE EXCEPTION 'PROVIDER_MANAGED_ACCOUNTS_CONTRACT_BLOCKED: account scope or AAD context backfill is incomplete'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_provider_managed_credentials
     WHERE (status = 'connected' AND account_identity_hash IS NULL)
        OR (account_identity_hash IS NOT NULL
          AND account_identity_hash !~ '^hmac-sha256:[0-9a-f]{64}$')
  ) THEN
    RAISE EXCEPTION 'PROVIDER_MANAGED_ACCOUNTS_CONTRACT_BLOCKED: keyed account identity backfill is incomplete'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_provider_managed_credentials
     WHERE account_identity_hash IS NOT NULL
       AND status IN ('connected', 'reauth_required')
     GROUP BY adapter_kind, account_identity_hash
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PROVIDER_MANAGED_ACCOUNTS_CONTRACT_BLOCKED: duplicate active product identities remain'
      USING ERRCODE = '55000';
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" DROP CONSTRAINT "ai_provider_auth_attempts_envelope_context_check";--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" DROP CONSTRAINT "ai_provider_managed_credentials_envelope_context_check";--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" DROP CONSTRAINT "ai_provider_revocation_jobs_account_scope_check";--> statement-breakpoint
ALTER TABLE "ai_providers" DROP CONSTRAINT "ai_providers_managed_account_binding_check";--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" DROP CONSTRAINT "ai_provider_managed_credentials_provider_adapter_fk";
--> statement-breakpoint
DROP INDEX "ai_provider_managed_credentials_provider_uidx";--> statement-breakpoint
DROP INDEX "ai_provider_managed_credentials_identity_idx";--> statement-breakpoint
DROP INDEX "ai_provider_revocation_jobs_source_uidx";--> statement-breakpoint
DROP INDEX "ai_provider_revocation_jobs_processing_provider_uidx";--> statement-breakpoint
DROP INDEX "ai_provider_revocation_jobs_account_source_uidx";--> statement-breakpoint
DROP INDEX "ai_provider_revocation_jobs_processing_account_uidx";--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ALTER COLUMN "envelope_context_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ALTER COLUMN "provider_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ALTER COLUMN "envelope_context_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ALTER COLUMN "account_scope_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ALTER COLUMN "envelope_context_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_managed_credentials_active_identity_uidx" ON "ai_provider_managed_credentials" USING btree ("adapter_kind","account_identity_hash") WHERE "ai_provider_managed_credentials"."account_identity_hash" IS NOT NULL AND "ai_provider_managed_credentials"."status" IN ('connected', 'reauth_required');--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_revocation_jobs_account_source_uidx" ON "ai_provider_revocation_jobs" USING btree ("adapter_kind","account_scope_id","source_kind","source_record_id","source_record_revision","reason");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_revocation_jobs_processing_account_uidx" ON "ai_provider_revocation_jobs" USING btree ("adapter_kind","account_scope_id") WHERE "ai_provider_revocation_jobs"."status" = 'processing';--> statement-breakpoint
ALTER TABLE "ai_provider_auth_attempts" ADD CONSTRAINT "ai_provider_auth_attempts_envelope_context_check" CHECK (btrim("ai_provider_auth_attempts"."envelope_context_id") <> '');--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ADD CONSTRAINT "ai_provider_managed_credentials_envelope_context_check" CHECK (btrim("ai_provider_managed_credentials"."envelope_context_id") <> '');--> statement-breakpoint
ALTER TABLE "ai_provider_revocation_jobs" ADD CONSTRAINT "ai_provider_revocation_jobs_account_scope_check" CHECK (btrim("ai_provider_revocation_jobs"."account_scope_id") <> ''
          AND btrim("ai_provider_revocation_jobs"."envelope_context_id") <> ''
          AND (
            ("ai_provider_revocation_jobs"."managed_credential_id" IS NULL
              AND "ai_provider_revocation_jobs"."credential_auth_epoch" IS NULL)
            OR ("ai_provider_revocation_jobs"."managed_credential_id" IS NOT NULL
              AND "ai_provider_revocation_jobs"."credential_auth_epoch" >= 1)
          ));--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_managed_account_binding_check" CHECK (("ai_providers"."adapter_kind" = 'generic'
            AND "ai_providers"."managed_account_binding_mode" IS NULL
            AND "ai_providers"."managed_credential_id" IS NULL)
          OR ("ai_providers"."adapter_kind" IN ('codex', 'xai', 'github_copilot')
            AND (
              ("ai_providers"."managed_account_binding_mode" = 'follow_default'
                AND "ai_providers"."managed_credential_id" IS NULL)
              OR ("ai_providers"."managed_account_binding_mode" = 'pinned'
                AND "ai_providers"."managed_credential_id" IS NOT NULL)
            )));
