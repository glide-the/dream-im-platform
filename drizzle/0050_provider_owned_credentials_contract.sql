-- [Input] 0049 compatibility expand plus a committed provider-owned-credentials-v1 receipt.
-- [Output] Direct Provider ownership, one live credential per Provider, and no product default routing relation.
-- [Pos] Forward-only PostgreSQL 0050 contract; validates the cutover before dropping only the empty defaults table.
-- [Sync] 2026-09-04: contract effective bindings without changing credential IDs, token envelopes, or Gateway history.

DO $$
DECLARE
  affected_rows bigint;
BEGIN
  IF EXISTS (
    SELECT 1 FROM ai_provider_auth_attempts
     WHERE status IN ('starting', 'pending')
  ) THEN
    RAISE EXCEPTION 'PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED: active auth attempts remain'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ai_provider_revocation_jobs
     WHERE status IN ('pending', 'processing', 'failed')
  ) THEN
    RAISE EXCEPTION 'PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED: non-terminal revocation jobs remain'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM ai_provider_revocation_jobs
     WHERE bundle_format_version IS NOT NULL
        OR bundle_key_id IS NOT NULL
        OR bundle_ciphertext IS NOT NULL
        OR bundle_nonce IS NOT NULL
        OR bundle_tag IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED: terminal revocation secret erasure is incomplete'
      USING ERRCODE = '55000';
  END IF;

  SELECT
    (SELECT count(*) FROM ai_providers WHERE adapter_kind <> 'generic')
    + (SELECT count(*) FROM ai_provider_managed_credentials)
    + (SELECT count(*) FROM ai_provider_auth_attempts)
    + (SELECT count(*) FROM ai_provider_revocation_jobs)
    INTO affected_rows;

  IF affected_rows > 0 AND NOT EXISTS (
    SELECT 1 FROM drizzle.data_migration_runs
     WHERE migration_key = 'provider-owned-credentials-v1'
       AND status = 'committed'
  ) THEN
    RAISE EXCEPTION 'PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED: run drizzle/data/provider-owned-credentials.ts --apply after 0049'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (SELECT 1 FROM ai_provider_managed_account_defaults) THEN
    RAISE EXCEPTION 'PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED: product defaults remain'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_providers p
      LEFT JOIN ai_provider_managed_credentials c
        ON c.id = p.managed_credential_id
       AND c.provider_id = p.id
       AND c.adapter_kind = p.adapter_kind
     WHERE p.adapter_kind IN ('codex', 'xai', 'github_copilot')
       AND (p.managed_account_binding_mode IS DISTINCT FROM 'pinned'
         OR (p.managed_credential_id IS NOT NULL
           AND (c.id IS NULL OR c.status NOT IN ('connected', 'reauth_required'))))
  ) THEN
    RAISE EXCEPTION 'PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED: direct Provider binding is incomplete or mismatched'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_provider_managed_credentials c
      LEFT JOIN ai_providers p
        ON p.id = c.provider_id
       AND p.adapter_kind = c.adapter_kind
     WHERE c.provider_id IS NOT NULL
       AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED: credential ownership is dangling or adapter-mismatched'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_provider_managed_credentials c
      LEFT JOIN ai_providers p
        ON p.id = c.provider_id
       AND p.adapter_kind = c.adapter_kind
       AND p.managed_credential_id = c.id
     WHERE c.status IN ('connected', 'reauth_required')
       AND p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED: live credential has no unique direct owner'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_provider_managed_credentials
     WHERE status IN ('connected', 'reauth_required')
     GROUP BY provider_id
    HAVING provider_id IS NULL OR count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED: Provider owns multiple or unowned live credentials'
      USING ERRCODE = '55000';
  END IF;
END;
$$;--> statement-breakpoint
DROP TABLE "ai_provider_managed_account_defaults";--> statement-breakpoint
ALTER TABLE "ai_providers" DROP CONSTRAINT "ai_providers_managed_account_binding_check";--> statement-breakpoint
ALTER TABLE "ai_providers" DROP CONSTRAINT "ai_providers_managed_credential_adapter_fk";
--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ADD CONSTRAINT "ai_provider_managed_credentials_provider_adapter_fk" FOREIGN KEY ("provider_id","adapter_kind") REFERENCES "public"."ai_providers"("id","adapter_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_managed_credential_owner_fk" FOREIGN KEY ("managed_credential_id","id","adapter_kind") REFERENCES "public"."ai_provider_managed_credentials"("id","provider_id","adapter_kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_managed_credentials_live_provider_uidx" ON "ai_provider_managed_credentials" USING btree ("provider_id") WHERE "ai_provider_managed_credentials"."provider_id" IS NOT NULL AND "ai_provider_managed_credentials"."status" IN ('connected', 'reauth_required');--> statement-breakpoint
ALTER TABLE "ai_provider_managed_credentials" ADD CONSTRAINT "ai_provider_managed_credentials_live_owner_check" CHECK ("ai_provider_managed_credentials"."status" = 'disconnected' OR "ai_provider_managed_credentials"."provider_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_managed_account_binding_check" CHECK (("ai_providers"."adapter_kind" = 'generic'
            AND "ai_providers"."managed_account_binding_mode" IS NULL
            AND "ai_providers"."managed_credential_id" IS NULL)
          OR ("ai_providers"."adapter_kind" IN ('codex', 'xai', 'github_copilot')
            AND "ai_providers"."managed_account_binding_mode" = 'pinned'));
