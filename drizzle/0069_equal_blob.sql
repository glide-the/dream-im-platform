-- [Input] Existing Chat Thread, message, task-session tables and one effective scheduled definition.
-- [Output] Additive scheduled definition/trigger catalog, limited data-role ACL and exact capability.
-- [Pos] Forward PostgreSQL expand migration; normal databases migrate only by explicit operator action.
-- [Sync] 2026-09-28: publish once/daily schedule storage and trigger fencing without a parallel Run.
CREATE TABLE "chat_scheduled_task" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"auth_user_id" text NOT NULL,
	"service_client_id" text NOT NULL,
	"source_thread_id" text NOT NULL,
	"create_request_key" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"schedule_kind" text NOT NULL,
	"time_zone" text NOT NULL,
	"local_date" text,
	"local_time" text NOT NULL,
	"single_offset_minutes" integer,
	"next_run_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"status_before_delete" text,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_chat_scheduled_task_create" UNIQUE("service_client_id","auth_user_id","create_request_key"),
	CONSTRAINT "ck_chat_scheduled_task_kind" CHECK (schedule_kind IN ('once','daily')),
	CONSTRAINT "ck_chat_scheduled_task_status" CHECK (status IN ('active','paused','exhausted','deleted')),
	CONSTRAINT "ck_chat_scheduled_task_revision" CHECK (revision >= 1),
	CONSTRAINT "ck_chat_scheduled_task_rule" CHECK ((schedule_kind = 'once' AND local_date IS NOT NULL AND single_offset_minutes IS NOT NULL) OR (schedule_kind = 'daily' AND local_date IS NULL AND single_offset_minutes IS NULL))
);
--> statement-breakpoint
CREATE TABLE "chat_scheduled_trigger" (
	"id" text PRIMARY KEY NOT NULL,
	"task_id" text NOT NULL,
	"user_id" bigint NOT NULL,
	"kind" text NOT NULL,
	"scheduled_at" timestamp with time zone,
	"manual_request_key" text,
	"definition_revision" integer NOT NULL,
	"title_snapshot" text NOT NULL,
	"prompt_snapshot" text NOT NULL,
	"source_thread_id" text NOT NULL,
	"time_zone_snapshot" text NOT NULL,
	"status" text NOT NULL,
	"claim_id" text,
	"lease_expires_at" timestamp with time zone,
	"task_session_id" text,
	"target_thread_id" text,
	"input_message_id" text,
	"final_message_id" text,
	"error_code" text,
	"skipped_from_at" timestamp with time zone,
	"skipped_through_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_chat_scheduled_trigger_task_session" UNIQUE("task_session_id"),
	CONSTRAINT "uq_chat_scheduled_trigger_target_thread" UNIQUE("target_thread_id"),
	CONSTRAINT "uq_chat_scheduled_trigger_input" UNIQUE("input_message_id"),
	CONSTRAINT "ck_chat_scheduled_trigger_kind" CHECK ((kind = 'scheduled' AND scheduled_at IS NOT NULL AND manual_request_key IS NULL) OR (kind = 'manual' AND scheduled_at IS NULL AND manual_request_key IS NOT NULL)),
	CONSTRAINT "ck_chat_scheduled_trigger_status" CHECK (status IN ('claimed','queued','running','succeeded','failed','state_unknown','skipped')),
	CONSTRAINT "ck_chat_scheduled_trigger_revision" CHECK (definition_revision >= 1)
);
--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD CONSTRAINT "fk_chat_scheduled_task_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD CONSTRAINT "fk_chat_scheduled_task_source" FOREIGN KEY ("source_thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_task" FOREIGN KEY ("task_id") REFERENCES "public"."chat_scheduled_task"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_source" FOREIGN KEY ("source_thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_session" FOREIGN KEY ("task_session_id") REFERENCES "public"."chat_task_session"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_target" FOREIGN KEY ("target_thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_input" FOREIGN KEY ("input_message_id") REFERENCES "public"."chat_message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_final" FOREIGN KEY ("final_message_id") REFERENCES "public"."chat_message"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_scheduled_task_due" ON "chat_scheduled_task" USING btree ("next_run_at") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "idx_chat_scheduled_task_owner" ON "chat_scheduled_task" USING btree ("user_id","source_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_chat_scheduled_trigger_plan" ON "chat_scheduled_trigger" USING btree ("task_id","scheduled_at") WHERE kind = 'scheduled';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_chat_scheduled_trigger_manual" ON "chat_scheduled_trigger" USING btree ("task_id","manual_request_key") WHERE kind = 'manual';--> statement-breakpoint
CREATE INDEX "idx_chat_scheduled_trigger_owner_time" ON "chat_scheduled_trigger" USING btree ("user_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "idx_chat_scheduled_trigger_reconcile" ON "chat_scheduled_trigger" USING btree ("lease_expires_at") WHERE status IN ('claimed','queued','running');--> statement-breakpoint
CREATE UNIQUE INDEX "uq_chat_scheduled_trigger_open" ON "chat_scheduled_trigger" USING btree ("task_id") WHERE status IN ('claimed','queued','running','state_unknown');
--> statement-breakpoint
-- Preserve the existing least-privilege Dream data role selected by its exact Chat privileges.
DO $chat_schedule_acl$
DECLARE data_role name; matching_roles integer;
BEGIN
  SELECT count(*)::integer, min(rolname) INTO matching_roles, data_role FROM pg_roles
   WHERE rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
     AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit
     AND has_table_privilege(oid, 'public.chat_thread', 'SELECT')
     AND has_table_privilege(oid, 'public.chat_thread', 'INSERT')
     AND has_table_privilege(oid, 'public.chat_task_session', 'SELECT')
     AND has_table_privilege(oid, 'drizzle.schema_capabilities', 'SELECT');
  IF matching_roles > 1 THEN RAISE EXCEPTION 'CHAT_SCHEDULE_DATA_ROLE_AMBIGUOUS' USING ERRCODE = '55000'; END IF;
  IF matching_roles = 1 THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.chat_scheduled_task, public.chat_scheduled_trigger TO %I', data_role);
  END IF;
END
$chat_schedule_acl$;
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('dream.chat-scheduled-task.v1', 1, 'bc9773921f07f894508be4baa19e5b625dba1091559f6ec3c5267d5d12080fb0', 'admin-drizzle-0069', '{"definition":"public.chat_scheduled_task","trigger":"public.chat_scheduled_trigger","execution_target":"public.chat_task_session"}'::jsonb);
