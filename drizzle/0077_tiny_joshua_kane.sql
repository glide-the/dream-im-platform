ALTER TABLE "chat_scheduled_trigger" DROP CONSTRAINT "uq_chat_scheduled_trigger_target_thread";--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" DROP CONSTRAINT "ck_chat_scheduled_task_kind";--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" DROP CONSTRAINT "ck_chat_scheduled_task_rule";--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD COLUMN "rrule" text;--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD COLUMN "run_thread_mode" text DEFAULT 'new_thread_each_run' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD COLUMN "model_alias" text;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD COLUMN "run_thread_mode_snapshot" text DEFAULT 'new_thread_each_run' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD COLUMN "model_alias_snapshot" text;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_chat_scheduled_trigger_new_target_thread" ON "chat_scheduled_trigger" USING btree ("target_thread_id") WHERE run_thread_mode_snapshot = 'new_thread_each_run' AND target_thread_id IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_chat_scheduled_trigger_source_thread_open" ON "chat_scheduled_trigger" USING btree ("target_thread_id") WHERE run_thread_mode_snapshot = 'source_thread' AND target_thread_id IS NOT NULL AND status IN ('claimed','queued','running','state_unknown');--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD CONSTRAINT "ck_chat_scheduled_task_thread_mode" CHECK (run_thread_mode IN ('source_thread','new_thread_each_run'));--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD CONSTRAINT "ck_chat_scheduled_task_model_alias" CHECK (model_alias IS NULL OR (char_length(model_alias) BETWEEN 1 AND 120 AND model_alias ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'));--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD CONSTRAINT "ck_chat_scheduled_task_kind" CHECK (schedule_kind IN ('once','daily','interval','rrule'));--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD CONSTRAINT "ck_chat_scheduled_task_rule" CHECK (
		(schedule_kind = 'once' AND local_date IS NOT NULL AND local_time IS NOT NULL AND single_offset_minutes IS NOT NULL AND interval_minutes IS NULL AND rrule IS NULL)
		OR (schedule_kind = 'daily' AND local_date IS NULL AND local_time IS NOT NULL AND single_offset_minutes IS NULL AND interval_minutes IS NULL AND rrule IS NULL)
		OR (schedule_kind = 'interval' AND local_date IS NULL AND local_time IS NULL AND single_offset_minutes IS NULL AND interval_minutes IS NOT NULL AND interval_minutes >= 1 AND rrule IS NULL)
		OR (schedule_kind = 'rrule' AND local_date IS NULL AND local_time IS NULL AND single_offset_minutes IS NULL AND interval_minutes IS NULL AND rrule IS NOT NULL AND char_length(rrule) BETWEEN 1 AND 512)
	);--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "ck_chat_scheduled_trigger_thread_mode" CHECK (run_thread_mode_snapshot IN ('source_thread','new_thread_each_run'));--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "ck_chat_scheduled_trigger_model_alias" CHECK (model_alias_snapshot IS NULL OR (char_length(model_alias_snapshot) BETWEEN 1 AND 120 AND model_alias_snapshot ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'));--> statement-breakpoint
INSERT INTO "drizzle"."schema_capabilities" (
	"capability", "version", "contract_sha256", "adopted_from", "metadata"
) VALUES (
	'dream.chat-scheduled-task.v3',
	3,
	'b96dbec6e1fafe249c9e545b3aa5d8549e6e02d17b968e7dcf164bde814d7f91',
	'admin-drizzle-0077',
	'{"definition":"public.chat_scheduled_task","trigger":"public.chat_scheduled_trigger","rules":["once","daily","interval","hourly","weekly"],"thread_modes":["source_thread","new_thread_each_run"],"model_snapshot":true,"source_open_trigger_unique":true}'::jsonb
);
