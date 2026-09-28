-- [Input] Existing limited Dream data role identified by its current Chat and capability privileges.
-- [Output] Queue/task table DML and queue identity sequence privileges for that exact role.
-- [Pos] Admin Drizzle forward ACL repair for Dream Chat input queue.
-- [Sync] 2026-09-27: upgrade existing activated roles; new installations use the updated unified ACL plan.
DO $chat_input_queue_acl$
DECLARE
  data_role name;
  matching_roles integer;
BEGIN
  SELECT count(*)::integer, min(rolname)
    INTO matching_roles, data_role
    FROM pg_roles
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

  IF matching_roles > 1 THEN
    RAISE EXCEPTION 'CHAT_INPUT_QUEUE_DATA_ROLE_AMBIGUOUS' USING ERRCODE = '55000';
  END IF;
  IF matching_roles = 1 THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_input_queue, public.chat_task_session TO %I', data_role);
    EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE public.chat_input_queue_queue_sequence_seq TO %I', data_role);
  END IF;
END
$chat_input_queue_acl$;
