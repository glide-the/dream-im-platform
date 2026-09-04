-- Custom SQL migration file, put your code below! --
-- [Input] 0051 definition plus a committed provider-deleted-credential-orphans-v1 repair receipt.
-- [Output] Validated reciprocal ownership for every live credential and no auth activity on deleted Providers.
-- [Pos] Forward-only PostgreSQL 0052 contract; validation only, with no credential or history rewrite.
-- [Sync] 2026-09-04: fail closed if deleted/unbound live credentials could still occupy a product identity.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM drizzle.data_migration_runs
     WHERE migration_key = 'provider-deleted-credential-orphans-v1'
       AND status = 'committed'
  ) THEN
    RAISE EXCEPTION 'PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT_BLOCKED: run drizzle/data/provider-deleted-credential-orphans.ts --apply after 0051'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_provider_managed_credentials AS credential
      LEFT JOIN ai_providers AS provider
        ON provider.id = credential.provider_id
       AND provider.adapter_kind = credential.adapter_kind
     WHERE credential.status IN ('connected', 'reauth_required')
       AND (
         provider.id IS NULL
         OR provider.status = 'deleted'
         OR provider.managed_credential_id IS DISTINCT FROM credential.id
       )
  ) THEN
    RAISE EXCEPTION 'PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT_BLOCKED: a live credential has no live current Provider owner'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_providers AS provider
      LEFT JOIN ai_provider_managed_credentials AS credential
        ON credential.id = provider.managed_credential_id
       AND credential.provider_id = provider.id
       AND credential.adapter_kind = provider.adapter_kind
     WHERE provider.adapter_kind IN ('codex', 'xai', 'github_copilot')
       AND provider.managed_credential_id IS NOT NULL
       AND (
         provider.status = 'deleted'
         OR credential.id IS NULL
         OR credential.status NOT IN ('connected', 'reauth_required')
       )
  ) THEN
    RAISE EXCEPTION 'PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT_BLOCKED: a Provider pointer is deleted, dangling, or non-live'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM ai_provider_auth_attempts AS attempt
      JOIN ai_providers AS provider
        ON provider.id = attempt.provider_id
       AND provider.adapter_kind = attempt.adapter_kind
     WHERE provider.status = 'deleted'
       AND attempt.status IN ('starting', 'pending')
  ) THEN
    RAISE EXCEPTION 'PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT_BLOCKED: a deleted Provider has an active authorization attempt'
      USING ERRCODE = '55000';
  END IF;
END;
$$;
