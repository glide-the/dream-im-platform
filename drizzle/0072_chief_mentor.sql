-- [Input] 0069-0071 scheduled trigger links and existing ordinary Chat deletion behavior.
-- [Output] Historical trigger rows keep nullable links and cannot block user Thread/TaskSession deletion.
-- [Pos] Forward compatibility migration; no trigger history backfill or normal-data rewrite.
-- [Sync] 2026-09-28: replace target RESTRICT links with SET NULL and publish the exact lifecycle capability.
ALTER TABLE "chat_scheduled_trigger" DROP CONSTRAINT "fk_chat_scheduled_trigger_session";
--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" DROP CONSTRAINT "fk_chat_scheduled_trigger_target";
--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" DROP CONSTRAINT "fk_chat_scheduled_trigger_input";
--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" DROP CONSTRAINT "fk_chat_scheduled_trigger_final";
--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_session" FOREIGN KEY ("task_session_id") REFERENCES "public"."chat_task_session"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_target" FOREIGN KEY ("target_thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_input" FOREIGN KEY ("input_message_id") REFERENCES "public"."chat_message"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "fk_chat_scheduled_trigger_final" FOREIGN KEY ("final_message_id") REFERENCES "public"."chat_message"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('dream.chat-scheduled-link-lifecycle.v1', 1, 'f2c197e58ef80cc2ef69f4af9a623389f6c2461e1ac3130ef3ad7976874a16cd', 'admin-drizzle-0072', '{"table":"public.chat_scheduled_trigger","links":"set-null-on-delete"}'::jsonb);
