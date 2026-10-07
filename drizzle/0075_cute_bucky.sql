ALTER TABLE "chat_scheduled_task" DROP CONSTRAINT "ck_chat_scheduled_task_kind";--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" DROP CONSTRAINT "ck_chat_scheduled_task_rule";--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ALTER COLUMN "local_time" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD COLUMN "interval_minutes" integer;--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD COLUMN "target_editor_session_id" text;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD COLUMN "target_editor_session_id_snapshot" text;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD COLUMN "unknown_recheck_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "idx_chat_scheduled_trigger_unknown_recheck" ON "chat_scheduled_trigger" USING btree ("unknown_recheck_at") WHERE status = 'state_unknown';--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD CONSTRAINT "ck_chat_scheduled_task_kind" CHECK (schedule_kind IN ('once','daily','interval'));--> statement-breakpoint
ALTER TABLE "chat_scheduled_task" ADD CONSTRAINT "ck_chat_scheduled_task_rule" CHECK (
		(schedule_kind = 'once' AND local_date IS NOT NULL AND local_time IS NOT NULL AND single_offset_minutes IS NOT NULL AND interval_minutes IS NULL)
		OR (schedule_kind = 'daily' AND local_date IS NULL AND local_time IS NOT NULL AND single_offset_minutes IS NULL AND interval_minutes IS NULL)
		OR (schedule_kind = 'interval' AND local_date IS NULL AND local_time IS NULL AND single_offset_minutes IS NULL AND interval_minutes IS NOT NULL AND interval_minutes >= 1)
	);--> statement-breakpoint
