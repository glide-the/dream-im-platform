-- [Input] Existing limited Dream DATA role and the additive 0082 memory tables.
-- [Output] SELECT/INSERT/UPDATE only on the two memory tables for that exact role.
-- [Pos] Forward ACL repair; immutable 0082 and its physical capability remain unchanged.
-- [Sync] 2026-10-15: activate memory operations for existing limited DATA roles.
DO $memory_data_acl$
DECLARE
  data_role name;
  matching_roles integer;
BEGIN
  SELECT count(*)::integer, min(r.rolname)
    INTO matching_roles, data_role
    FROM pg_roles r
   WHERE r.rolcanlogin AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
     AND NOT r.rolreplication AND NOT r.rolbypassrls AND NOT r.rolinherit
     AND NOT EXISTS (SELECT 1 FROM pg_auth_members m WHERE m.member=r.oid)
     AND has_table_privilege(r.oid, 'public.chat_thread', 'SELECT')
     AND has_table_privilege(r.oid, 'public.chat_thread', 'INSERT')
     AND has_table_privilege(r.oid, 'public.chat_thread', 'UPDATE')
     AND has_table_privilege(r.oid, 'public.chat_thread', 'DELETE')
     AND has_table_privilege(r.oid, 'public.reflection_task_section', 'SELECT')
     AND has_table_privilege(r.oid, 'public.reflection_task_section', 'INSERT')
     AND has_table_privilege(r.oid, 'drizzle.schema_capabilities', 'SELECT');
  IF matching_roles > 1 THEN
    RAISE EXCEPTION 'MEMORY_DATA_ROLE_AMBIGUOUS' USING ERRCODE = '55000';
  END IF;
  IF matching_roles = 1 THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON TABLE public.memory_artifact, public.memory_behavior_settings TO %I', data_role);
  END IF;
END
$memory_data_acl$;
