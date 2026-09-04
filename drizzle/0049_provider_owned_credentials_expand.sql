-- [Input] 0048 product account-pool contract and a forthcoming audited ownership cutover.
-- [Output] Transitional pinned-without-account compatibility plus the v1 Provider-owned data migration definition.
-- [Pos] Forward-only PostgreSQL 0049 expand; no account, token envelope, or historical request is rewritten here.
-- [Sync] 2026-09-04: open the compatibility window before resolving effective bindings into direct Provider ownership.

ALTER TABLE "ai_providers" DROP CONSTRAINT "ai_providers_managed_account_binding_check";--> statement-breakpoint
CREATE UNIQUE INDEX "ai_provider_managed_credentials_id_provider_adapter_uidx" ON "ai_provider_managed_credentials" USING btree ("id","provider_id","adapter_kind");--> statement-breakpoint
ALTER TABLE "ai_providers" ADD CONSTRAINT "ai_providers_managed_account_binding_check" CHECK (("ai_providers"."adapter_kind" = 'generic'
            AND "ai_providers"."managed_account_binding_mode" IS NULL
            AND "ai_providers"."managed_credential_id" IS NULL)
          OR ("ai_providers"."adapter_kind" IN ('codex', 'xai', 'github_copilot')
            AND (
              ("ai_providers"."managed_account_binding_mode" = 'follow_default'
                AND "ai_providers"."managed_credential_id" IS NULL)
              OR "ai_providers"."managed_account_binding_mode" = 'pinned'
            )));--> statement-breakpoint
INSERT INTO "drizzle"."data_migration_definitions" (
  "migration_key", "owner", "runner_contract", "runner_path",
  "expected_table_count", "expected_source_row_count", "metadata"
) VALUES (
  'provider-owned-credentials-v1',
  'admin',
  'ink-admin-provider-owned-credentials-v1',
  'drizzle/data/provider-owned-credentials.ts',
  5,
  NULL,
  '{"tables":["ai_providers","ai_provider_managed_credentials","ai_provider_managed_account_defaults","ai_provider_auth_attempts","ai_provider_revocation_jobs"],"ownershipSource":"effective-binding","conflictPolicy":"fail-closed","secretTransform":"none","defaultMode":"dry-run"}'::jsonb
);
