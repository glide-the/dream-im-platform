-- [Input] Scheduled Chat trigger claim, existing encrypted Runtime delegation and explicit Gateway scope.
-- [Output] Additive grant-source binding, source CHECK and exact runtime capability.
-- [Pos] Forward identity expansion; 0069 scheduled storage must precede this migration.
-- [Sync] 2026-09-28: source-fence server-persistence and gateway-cli grants to one scheduled claim.
CREATE TABLE "identity"."scheduled_chat_grant_sources" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"trigger_id" text NOT NULL,
	"claim_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" DROP CONSTRAINT "runtime_delegations_authority_source_check";--> statement-breakpoint
ALTER TABLE "identity"."scheduled_chat_grant_sources" ADD CONSTRAINT "scheduled_chat_grant_sources_token_hash_runtime_delegations_token_hash_fk" FOREIGN KEY ("token_hash") REFERENCES "identity"."runtime_delegations"("token_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity"."scheduled_chat_grant_sources" ADD CONSTRAINT "scheduled_chat_grant_sources_trigger_id_chat_scheduled_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."chat_scheduled_trigger"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scheduled_chat_grant_sources_trigger_idx" ON "identity"."scheduled_chat_grant_sources" USING btree ("trigger_id","claim_id");--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_authority_source_check" CHECK ((
    "identity"."runtime_delegations"."authority_source" IS NULL
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'story-confirmation-claim'
    AND "identity"."runtime_delegations"."source_message_id" IS NOT NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NOT NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NULL
    AND "identity"."runtime_delegations"."purpose" = 'server-persistence'
    AND "identity"."runtime_delegations"."run_id" IS NOT NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
    AND "identity"."runtime_delegations"."gateway_api_key_id" IS NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'reflection-task-authority'
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NOT NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NULL
    AND "identity"."runtime_delegations"."purpose" = 'gateway-cli'
    AND "identity"."runtime_delegations"."run_id" IS NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
    AND "identity"."runtime_delegations"."gateway_api_key_id" IS NOT NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'task-result-claim'
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NOT NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NOT NULL
    AND (
      ("identity"."runtime_delegations"."purpose" = 'server-persistence' AND "identity"."runtime_delegations"."gateway_api_key_id" IS NULL) OR
      ("identity"."runtime_delegations"."purpose" = 'gateway-cli' AND "identity"."runtime_delegations"."gateway_api_key_id" IS NOT NULL)
    )
    AND "identity"."runtime_delegations"."run_id" IS NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
  ) OR (
    "identity"."runtime_delegations"."authority_source" = 'scheduled-chat-authority'
    AND "identity"."runtime_delegations"."source_message_id" IS NULL
    AND "identity"."runtime_delegations"."source_claim_id" IS NULL
    AND "identity"."runtime_delegations"."source_reflection_authority_hash" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_id" IS NULL
    AND "identity"."runtime_delegations"."source_task_result_claim_id" IS NULL
    AND "identity"."runtime_delegations"."purpose" IN ('server-persistence','gateway-cli')
    AND "identity"."runtime_delegations"."run_id" IS NULL
    AND "identity"."runtime_delegations"."editor_session_id" IS NULL
    AND (("identity"."runtime_delegations"."purpose" = 'server-persistence' AND "identity"."runtime_delegations"."gateway_api_key_id" IS NULL)
      OR ("identity"."runtime_delegations"."purpose" = 'gateway-cli' AND "identity"."runtime_delegations"."gateway_api_key_id" IS NOT NULL))
  ));
--> statement-breakpoint
DO $scheduled_chat_grant_acl$
DECLARE data_role name; matching_roles integer;
BEGIN
  SELECT count(*)::integer, min(rolname) INTO matching_roles, data_role FROM pg_roles
   WHERE rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
     AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
     AND has_table_privilege(oid, 'identity.runtime_delegations', 'SELECT')
     AND has_table_privilege(oid, 'identity.runtime_delegations', 'INSERT')
     AND has_table_privilege(oid, 'public.chat_scheduled_trigger', 'SELECT')
     AND has_table_privilege(oid, 'drizzle.schema_capabilities', 'SELECT');
  IF matching_roles > 1 THEN RAISE EXCEPTION 'SCHEDULE_GRANT_DATA_ROLE_AMBIGUOUS' USING ERRCODE = '55000'; END IF;
  IF matching_roles = 1 THEN
    EXECUTE format('GRANT SELECT, INSERT ON TABLE identity.scheduled_chat_grant_sources TO %I', data_role);
  END IF;
END
$scheduled_chat_grant_acl$;
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('identity.scheduled-chat-runtime.v1', 1, 'f84bcd8588c399121a9fd71f6ea4e14bf718a9d6443c5d82f28769300cf2494b', 'admin-drizzle-0070', '{"table":"identity.scheduled_chat_grant_sources","authority_source":"scheduled-chat-authority"}'::jsonb);
