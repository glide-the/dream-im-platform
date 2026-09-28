-- [Input] Existing Chat task/message tables and Runtime delegation source-shape contract.
-- [Output] Additive task-result notice, claim-bound source grants, ACL and exact capability.
-- [Pos] Forward Admin Drizzle migration; no application startup DDL or business backfill.
-- [Sync] 2026-09-27: publish one notice per task/target turn with service claim recovery.
CREATE TABLE "chat_task_result" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"target_turn_id" text NOT NULL,
	"target_final_message_id" text NOT NULL,
	"source_thread_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"claim_id" text,
	"claim_request_key" text,
	"source_turn_id" text,
	"source_input_message_id" text,
	"source_final_message_id" text,
	"error_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_chat_task_result_task_turn" UNIQUE("task_id","target_turn_id"),
	CONSTRAINT "uq_chat_task_result_source_turn" UNIQUE("source_thread_id","source_turn_id"),
	CONSTRAINT "uq_chat_task_result_source_input" UNIQUE("source_input_message_id"),
	CONSTRAINT "uq_chat_task_result_claim_request" UNIQUE("claim_request_key"),
	CONSTRAINT "ck_chat_task_result_status" CHECK (status IN ('pending','dispatching','delivered','failed','state_unknown')),
	CONSTRAINT "ck_chat_task_result_revision" CHECK (revision >= 1),
	CONSTRAINT "ck_chat_task_result_claim_request" CHECK (claim_request_key IS NULL OR claim_request_key ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ck_chat_task_result_claim" CHECK ((status = 'pending' AND claim_id IS NULL AND claim_request_key IS NULL AND source_turn_id IS NULL AND source_input_message_id IS NULL AND source_final_message_id IS NULL AND error_code IS NULL) OR (status <> 'pending' AND claim_id IS NOT NULL AND source_turn_id IS NOT NULL AND source_input_message_id IS NOT NULL)),
	CONSTRAINT "ck_chat_task_result_delivery" CHECK ((status = 'delivered' AND source_final_message_id IS NOT NULL AND error_code IS NULL) OR (status <> 'delivered' AND source_final_message_id IS NULL))
);
--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" DROP CONSTRAINT "runtime_delegations_authority_source_check";--> statement-breakpoint
ALTER TABLE "chat_task_session" ADD COLUMN "return_result" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "source_task_result_id" text;--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD COLUMN "source_task_result_claim_id" text;--> statement-breakpoint
ALTER TABLE "chat_task_result" ADD CONSTRAINT "fk_chat_task_result_task" FOREIGN KEY ("task_id") REFERENCES "public"."chat_task_session"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_task_result" ADD CONSTRAINT "fk_chat_task_result_target_message" FOREIGN KEY ("target_final_message_id") REFERENCES "public"."chat_message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_task_result" ADD CONSTRAINT "fk_chat_task_result_source_thread" FOREIGN KEY ("source_thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_task_result" ADD CONSTRAINT "fk_chat_task_result_source_input" FOREIGN KEY ("source_input_message_id") REFERENCES "public"."chat_message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_task_result" ADD CONSTRAINT "fk_chat_task_result_source_message" FOREIGN KEY ("source_final_message_id") REFERENCES "public"."chat_message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_chat_task_result_source_dispatching" ON "chat_task_result" USING btree ("source_thread_id") WHERE status = 'dispatching';--> statement-breakpoint
CREATE INDEX "idx_chat_task_result_source_status" ON "chat_task_result" USING btree ("source_thread_id","status","created_at");--> statement-breakpoint
ALTER TABLE "identity"."runtime_delegations" ADD CONSTRAINT "runtime_delegations_source_task_result_id_chat_task_result_id_fk" FOREIGN KEY ("source_task_result_id") REFERENCES "public"."chat_task_result"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runtime_delegations_task_result_claim_uidx" ON "identity"."runtime_delegations" USING btree ("service_client_id","source_task_result_id","source_task_result_claim_id","purpose") WHERE "identity"."runtime_delegations"."authority_source" = 'task-result-claim';--> statement-breakpoint
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
  ));--> statement-breakpoint
-- The existing limited Dream data role is identified by its exact Chat DML shape.
-- No role is created or inferred from a deployment environment name.
DO $chat_task_result_acl$
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
     AND has_table_privilege(oid, 'public.chat_message', 'SELECT')
     AND has_table_privilege(oid, 'public.chat_message', 'INSERT')
     AND has_table_privilege(oid, 'public.chat_task_session', 'SELECT')
     AND has_table_privilege(oid, 'drizzle.schema_capabilities', 'SELECT');
  IF matching_roles > 1 THEN
    RAISE EXCEPTION 'CHAT_TASK_RESULT_DATA_ROLE_AMBIGUOUS' USING ERRCODE = '55000';
  END IF;
  IF matching_roles = 1 THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_task_result TO %I', data_role);
  END IF;
END
$chat_task_result_acl$;--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('dream.chat-task-result.v1', 1, '9534e484926e69f2f284a4d785b770a5f347d044063a71ab29d08d59d8fa320c', 'admin-drizzle-0068', '{"table":"public.chat_task_result","authority":"task-result-claim"}'::jsonb);
