ALTER TABLE "chat_task_session" ADD COLUMN "launch_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_task_session" ADD COLUMN "launch_error_code" text;--> statement-breakpoint
ALTER TABLE "chat_task_session" ADD CONSTRAINT "ck_chat_task_session_launch_status" CHECK (launch_status IN ('pending','starting','failed'));
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('dream.chat-task-session.v2', 2, 'adfe898a136f97293cf80c984d1ad21a69848ab0644489d1a59ac1d3b92f5afe', 'admin-drizzle-0066', '{"table":"public.chat_task_session","launch":"single-claim"}'::jsonb);
