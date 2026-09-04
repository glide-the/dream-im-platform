-- Custom SQL migration file, put your code below! --
-- [Input] 0050 direct Provider ownership plus an explicit orphan-repair runner.
-- [Output] Registered provider-deleted-credential-orphans-v1 data migration definition.
-- [Pos] Forward-only PostgreSQL 0051 expand; no Provider, credential, attempt, or secret row is changed here.
-- [Sync] 2026-09-04: register audited repair before validating deleted/unbound credential ownership.

INSERT INTO "drizzle"."data_migration_definitions" (
  "migration_key", "owner", "runner_contract", "runner_path",
  "expected_table_count", "expected_source_row_count", "metadata"
) VALUES (
  'provider-deleted-credential-orphans-v1',
  'admin',
  'ink-admin-provider-deleted-credential-orphans-v1',
  'drizzle/data/provider-deleted-credential-orphans.ts',
  3,
  NULL,
  '{"tables":["ai_providers","ai_provider_managed_credentials","ai_provider_auth_attempts"],"repairScope":"credentials-without-a-live-current-owner","remoteRevocation":"not_attempted","secretTransform":"erase-local-envelope","historyPolicy":"retain","defaultMode":"dry-run"}'::jsonb
);
