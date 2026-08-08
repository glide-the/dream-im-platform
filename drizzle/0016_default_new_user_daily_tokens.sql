-- New canonical users receive a conservative Gateway trial ceiling without
-- rewriting limits that operators already configured for existing users.
ALTER TABLE "platform_users"
  ALTER COLUMN "daily_token_limit" SET DEFAULT 100000;

COMMENT ON COLUMN "platform_users"."daily_token_limit" IS
  'User-level daily Gateway token ceiling; new users default to 100000 and existing values are preserved.';
