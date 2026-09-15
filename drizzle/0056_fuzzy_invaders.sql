ALTER TABLE "identity"."runtime_delegations" DROP CONSTRAINT "runtime_delegations_creation_check";--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_creation_check" CHECK ("identity"."runtime_delegations"."request_id" IS NULL OR ("identity"."runtime_delegations"."oauth_client_id" IS NOT NULL AND "identity"."runtime_delegations"."input_sha256" IS NOT NULL AND "identity"."runtime_delegations"."input_sha256" ~ '^[0-9a-f]{64}$' AND "identity"."runtime_delegations"."token_ciphertext" IS NOT NULL AND "identity"."runtime_delegations"."maximum_expires_at" IS NOT NULL));--> statement-breakpoint
-- Controlled canonical registration is owned by the explicit Drizzle migration
-- role. Auth receives EXECUTE only, never direct canonical/subscription writes.
CREATE FUNCTION identity.register_canonical_user(p_auth_user_id text, p_provider_id text, p_password_hash text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
AS $register$
DECLARE
  v_identity identity."user"%ROWTYPE;
  v_canonical_id bigint;
BEGIN
  IF p_provider_id NOT IN ('google', 'credential') OR p_provider_id IS NULL
    OR (p_provider_id = 'credential' AND (p_password_hash IS NULL OR p_password_hash = ''))
    OR (p_provider_id = 'google' AND p_password_hash IS NOT NULL) THEN
    RAISE EXCEPTION 'registration provider unavailable' USING ERRCODE = '23514';
  END IF;
  SELECT * INTO v_identity FROM identity."user" WHERE id = p_auth_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'registration identity unavailable' USING ERRCODE = '23514'; END IF;
  IF EXISTS (SELECT 1 FROM identity.subject_links WHERE auth_user_id = p_auth_user_id)
    OR EXISTS (SELECT 1 FROM public.users WHERE email = v_identity.email) THEN
    RAISE EXCEPTION 'explicit subject adoption required' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.users (email, password_hash, display_name, avatar_url)
    VALUES (v_identity.email, COALESCE(p_password_hash, '!external-auth'), v_identity.name, v_identity.image)
    RETURNING id INTO v_canonical_id;
  -- The existing canonical insert triggers provision the platform projection
  -- and published Free subscription. Verify the original default model and
  -- current positive allowance/activation event, or roll the whole insert back.
  IF NOT EXISTS (
    SELECT 1 FROM public.platform_users AS platform
    JOIN public.subscriptions AS subscription ON subscription.platform_user_id = platform.id AND subscription.status = 'active'
    JOIN public.subscription_plan_versions AS version ON version.id = subscription.plan_version_id AND version.status = 'published'
    JOIN public.subscription_plans AS plan ON plan.id = version.plan_id AND plan.code = 'free' AND plan.status = 'active'
    JOIN public.subscription_plan_entitlements AS entitlement ON entitlement.plan_version_id = version.id AND entitlement.enabled AND entitlement.is_default AND entitlement.gateway_scopes @> ARRAY['messages:create']::text[]
    JOIN public.ai_models AS model ON model.id = entitlement.model_id AND model.enabled
    JOIN public.subscription_usage_allowances AS allowance ON allowance.subscription_id = subscription.id AND allowance.period_number = subscription.current_period_number AND allowance.granted_tokens > 0
    JOIN public.subscription_events AS event ON event.subscription_id = subscription.id AND event.event_type = 'activated'
    WHERE platform.source = 'ink-dream' AND platform.external_user_id = v_canonical_id::text AND platform.status = 'active'
  ) THEN RAISE EXCEPTION 'registration initialization unavailable' USING ERRCODE = '23514'; END IF;
  INSERT INTO identity.subject_links (auth_user_id, canonical_user_id, evidence)
    VALUES (p_auth_user_id, v_canonical_id, 'new-' || p_provider_id || '-account');
  RETURN v_canonical_id::text;
END;
$register$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity.register_canonical_user(text, text, text) FROM PUBLIC;
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata) VALUES ('identity.registration-integrity.v1', 1, '9a051b12a0f964d244f9f24d8c286a35ca39b67ddd6fbb242c626c6df159497e', 'admin-drizzle-0056', '{"schema":"identity","phase":"expand","registration":"controlled-function","required_hash":"explicit-not-null"}'::jsonb);
