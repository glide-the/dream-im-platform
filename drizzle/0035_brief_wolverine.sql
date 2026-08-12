-- gateway-default-token-limits-v1 updates only schema defaults. Existing user
-- policy values are changed by drizzle/data/gateway-default-token-limits.mjs.
ALTER TABLE "platform_users" ALTER COLUMN "daily_token_limit" SET DEFAULT 1000000000;--> statement-breakpoint
ALTER TABLE "platform_users" ALTER COLUMN "monthly_token_limit" SET DEFAULT 10000000000;--> statement-breakpoint
COMMENT ON COLUMN "platform_users"."daily_token_limit" IS
  'User-level daily Gateway 429 Token ceiling; gateway-default-token-limits-v1 defaults to 1000000000.';--> statement-breakpoint
COMMENT ON COLUMN "platform_users"."monthly_token_limit" IS
  'User-level calendar-month Gateway 429 Token ceiling; gateway-default-token-limits-v1 defaults to 10000000000.';--> statement-breakpoint
INSERT INTO "drizzle"."data_migration_definitions" (
  "migration_key", "owner", "runner_contract", "runner_path",
  "expected_table_count", "expected_source_row_count", "metadata"
) VALUES (
  'gateway-default-token-limits-v1',
  'admin',
  'ink-admin-gateway-default-token-limits-v1',
  'drizzle/data/gateway-default-token-limits.mjs',
  1,
  NULL,
  '{"table":"platform_users","dailyTokenLimit":1000000000,"monthlyTokenLimit":10000000000,"effect":"429-only"}'::jsonb
);
