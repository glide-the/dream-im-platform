-- Real control-plane relationships for isolated PostgreSQL E2E only.

-- Migration 0015 provisions the internal identity/account from canonical
-- users. The fixture only adds deterministic financial state; it does not
-- create a second user record.
UPDATE platform_users
SET tier = 'free', status = 'active'
WHERE source = 'ink-dream' AND external_user_id = '101';

UPDATE billing_accounts
SET available_microusd = 9000000, reserved_microusd = 1000000
WHERE platform_user_id = (
  SELECT id FROM platform_users
  WHERE source = 'ink-dream' AND external_user_id = '101'
);

INSERT INTO ai_providers (
  id, code, name, protocol, base_url, status
) VALUES (
  'provider-e2e', 'provider-e2e', 'E2E Provider', 'anthropic',
  'https://api.anthropic.com', 'disabled'
);

INSERT INTO ai_models (
  id, provider_id, code, upstream_model, display_name,
  context_window, max_output_tokens, enabled
) VALUES (
  'model-e2e', 'provider-e2e', 'model-e2e', 'model-e2e-upstream',
  'E2E Model', 200000, 8192, true
);

INSERT INTO ai_pricing_rules (
  id, model_id, user_tier,
  input_price_microusd_per_million,
  output_price_microusd_per_million,
  cache_read_price_microusd_per_million,
  cache_write_price_microusd_per_million,
  status, effective_from
) VALUES (
  'pricing-e2e', 'model-e2e', 'free',
  3000000, 15000000, 300000, 3750000,
  'active', CURRENT_TIMESTAMP - INTERVAL '1 day'
);

INSERT INTO gateway_api_keys (
  id, platform_user_id, name, key_prefix, key_hash, scopes, status
) VALUES (
  'gateway-key-e2e', (SELECT id FROM platform_users WHERE source = 'ink-dream' AND external_user_id = '101'), 'E2E key', 'ink_e2e',
  'fixture-hash-not-a-credential', ARRAY['messages:create'], 'active'
);

INSERT INTO gateway_requests (
  id, platform_user_id, gateway_api_key_id, provider_id, model_id,
  pricing_rule_id, protocol, requested_model, resolved_model,
  status, outcome, input_token_semantics, estimated_tokens,
  input_price_snapshot, output_price_snapshot,
  cache_read_price_snapshot, cache_write_price_snapshot,
  reserved_microusd, error_code, error_message, created_at
) VALUES (
  'request-settlement-failed-e2e', (SELECT id FROM platform_users WHERE source = 'ink-dream' AND external_user_id = '101'), 'gateway-key-e2e',
  'provider-e2e', 'model-e2e', 'pricing-e2e', 'anthropic',
  'model-e2e', 'model-e2e-upstream', 'settlement_failed', 'failed',
  'fresh', 1000, 3000000, 15000000, 300000, 3750000,
  1000000, 'UPSTREAM_STREAM_INTERRUPTED', 'Fixture stream interruption',
  CURRENT_TIMESTAMP
);

INSERT INTO billing_ledger_entries (
  id, account_id, platform_user_id, gateway_request_id, entry_type,
  amount_microusd, available_before_microusd, available_after_microusd,
  reserved_before_microusd, reserved_after_microusd, idempotency_key,
  description, actor_type
) VALUES (
  'ledger-reserve-e2e',
  (SELECT id FROM billing_accounts WHERE platform_user_id = (SELECT id FROM platform_users WHERE source = 'ink-dream' AND external_user_id = '101')),
  (SELECT id FROM platform_users WHERE source = 'ink-dream' AND external_user_id = '101'),
  'request-settlement-failed-e2e', 'reserve', 1000000,
  10000000, 9000000, 0, 1000000, 'fixture-reserve-e2e',
  'E2E preauthorization', 'gateway'
);

INSERT INTO user_model_permissions (
  id, platform_user_id, model_id, enabled, requests_per_minute,
  daily_token_limit, monthly_token_limit
) VALUES (
  'model-permission-e2e', (SELECT id FROM platform_users WHERE source = 'ink-dream' AND external_user_id = '101'), 'model-e2e', true, 30, 100000, 1000000
);

INSERT INTO gateway_rate_limits (
  platform_user_id, model_id, window_type, window_start,
  request_count, token_count
) VALUES (
  (SELECT id FROM platform_users WHERE source = 'ink-dream' AND external_user_id = '101'), 'model-e2e', 'minute', date_trunc('minute', CURRENT_TIMESTAMP), 1, 1000
);
