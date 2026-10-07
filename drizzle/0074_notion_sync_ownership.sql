-- [Input] Existing Notion JSON/rows and SELECT-only Admin data-role identity privileges.
-- [Output] Restricted actor-lock function and exact single-owner Notion execution capability.
-- [Pos] Forward expand migration; no business rows, tables, columns or legacy syncing state are rewritten.
-- [Sync] 2026-10-07: keep identity locks atomic without giving DATA an identity UPDATE privilege.
CREATE FUNCTION identity.lock_active_notion_sync_actor(canonical_id bigint, subject_id text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER VOLATILE PARALLEL UNSAFE
SET search_path = pg_catalog, pg_temp
AS $notion_actor$
DECLARE active_subject text;
BEGIN
  IF canonical_id IS NULL OR canonical_id <= 0 THEN RETURN false; END IF;
  SELECT link.auth_user_id INTO active_subject
    FROM identity.subject_links AS link
    JOIN public.users AS canonical ON canonical.id = link.canonical_user_id
    JOIN public.platform_users AS platform ON platform.source = 'ink-dream'
      AND platform.external_user_id = canonical.id::text
   WHERE link.canonical_user_id = canonical_id AND canonical.status = 'active'
     AND platform.status = 'active'
     AND (subject_id IS NULL OR link.auth_user_id = subject_id)
   FOR SHARE OF link, canonical, platform;
  RETURN active_subject IS NOT NULL;
END;
$notion_actor$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION identity.lock_active_notion_sync_actor(bigint, text) FROM PUBLIC;
--> statement-breakpoint
DO $notion_sync_acl$
DECLARE data_role name; matching_roles integer;
BEGIN
  SELECT count(*)::integer, min(rolname) INTO matching_roles, data_role FROM pg_roles
   WHERE rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
     AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
     AND has_table_privilege(oid, 'public.chat_thread', 'SELECT')
     AND has_table_privilege(oid, 'public.chat_thread', 'INSERT')
     AND has_table_privilege(oid, 'public.chat_thread', 'UPDATE')
     AND has_table_privilege(oid, 'public.chat_thread', 'DELETE')
     AND has_table_privilege(oid, 'public.chat_message', 'SELECT')
     AND has_table_privilege(oid, 'public.chat_message', 'INSERT')
     AND has_table_privilege(oid, 'public.chat_message', 'UPDATE')
     AND has_table_privilege(oid, 'public.chat_message', 'DELETE')
     AND has_table_privilege(oid, 'drizzle.schema_capabilities', 'SELECT');
  IF matching_roles > 1 THEN RAISE EXCEPTION 'NOTION_SYNC_DATA_ROLE_AMBIGUOUS' USING ERRCODE = '55000'; END IF;
  IF matching_roles = 1 THEN
    EXECUTE format('GRANT EXECUTE ON FUNCTION identity.lock_active_notion_sync_actor(bigint, text) TO %I', data_role);
  END IF;
END
$notion_sync_acl$;
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('dream.notion-sync-ownership.v1', 1, 'a54b947c69ea0f129d22fd440c3a9f5694026ac0977adef2d5b09a97d7a9e993', 'admin-drizzle-0074', '{"storage":"resource_connectors.config_json","actor_lock":"identity.lock_active_notion_sync_actor(bigint,text)","claims_default":"disabled"}'::jsonb);
