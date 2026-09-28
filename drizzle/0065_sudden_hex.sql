CREATE TABLE "chat_task_session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"source_thread_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"request_key" text NOT NULL,
	"initial_message_id" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_chat_task_session_target_thread" UNIQUE("thread_id"),
	CONSTRAINT "uq_chat_task_session_source_request" UNIQUE("source_thread_id","request_key")
);
--> statement-breakpoint
ALTER TABLE "chat_task_session" ADD CONSTRAINT "fk_chat_task_session_user" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_task_session" ADD CONSTRAINT "fk_chat_task_session_source" FOREIGN KEY ("source_thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_task_session" ADD CONSTRAINT "fk_chat_task_session_target" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_task_session" ADD CONSTRAINT "fk_chat_task_session_initial_message" FOREIGN KEY ("initial_message_id") REFERENCES "public"."chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_task_session_user_source" ON "chat_task_session" USING btree ("user_id","source_thread_id");
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('dream.chat-task-session.v1', 1, 'b3c9cde0bfbc6cfc54e22329f73dccdb2061622a8e5df6f0058fe93aca0ab07f', 'admin-drizzle-0065', '{"table":"public.chat_task_session","binding":"one-task-one-thread"}'::jsonb);
