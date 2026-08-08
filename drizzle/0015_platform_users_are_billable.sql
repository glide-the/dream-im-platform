-- Every canonical product user is inherently billable. `platform_users` is
-- retained only as an internal text-key control-plane identity required by
-- existing Gateway/Billing foreign keys; it is not a separately managed user.

INSERT INTO platform_users (
  id, source, external_user_id, email, display_name, tier, status, metadata
)
SELECT
  'usr_' || md5('ink-dream:' || u.id::text),
  'ink-dream',
  u.id::text,
  u.email,
  u.display_name,
  'free',
  'active',
  jsonb_build_object('managedBy', 'canonical-users')
FROM users AS u
ON CONFLICT (source, external_user_id) DO UPDATE
SET email = EXCLUDED.email,
    display_name = EXCLUDED.display_name,
    updated_at = NOW();

INSERT INTO billing_accounts (id, platform_user_id)
SELECT
  'acct_' || md5('canonical-user:' || pu.id),
  pu.id
FROM users AS u
JOIN platform_users AS pu
  ON pu.source = 'ink-dream'
 AND pu.external_user_id = u.id::text
ON CONFLICT (platform_user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION sync_canonical_user_billing_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  billing_identity_id text;
BEGIN
  INSERT INTO platform_users (
    id, source, external_user_id, email, display_name, tier, status, metadata
  ) VALUES (
    'usr_' || md5('ink-dream:' || NEW.id::text),
    'ink-dream',
    NEW.id::text,
    NEW.email,
    NEW.display_name,
    'free',
    'active',
    jsonb_build_object('managedBy', 'canonical-users')
  )
  ON CONFLICT (source, external_user_id) DO UPDATE
  SET email = EXCLUDED.email,
      display_name = EXCLUDED.display_name,
      updated_at = NOW()
  RETURNING id INTO billing_identity_id;

  INSERT INTO billing_accounts (id, platform_user_id)
  VALUES (
    'acct_' || md5('canonical-user:' || billing_identity_id),
    billing_identity_id
  )
  ON CONFLICT (platform_user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS users_sync_billing_identity ON users;
CREATE TRIGGER users_sync_billing_identity
AFTER INSERT OR UPDATE OF email, display_name ON users
FOR EACH ROW
EXECUTE FUNCTION sync_canonical_user_billing_identity();

COMMENT ON TABLE platform_users IS
  'Internal one-to-one Billing/Gateway identity for canonical users; not a separate product user resource.';
COMMENT ON FUNCTION sync_canonical_user_billing_identity() IS
  'Idempotently provisions the internal Billing identity and zero-balance account for every canonical user.';
