-- [Input] Admin-owned Chat schema and existing queue.
-- [Output] Nullable origin, durable continuation owner/phase, and exact capability.
-- [Pos] Forward expand; no business backfill or startup DDL.
-- [Sync] 2026-11-04: same-session cross-platform continuation.
ALTER TABLE "chat_input_queue" ADD COLUMN "continuation_owner" text;--> statement-breakpoint
ALTER TABLE "chat_input_queue" ADD COLUMN "continuation_phase" text;--> statement-breakpoint
ALTER TABLE "chat_thread" ADD COLUMN "created_execution_origin" text;--> statement-breakpoint
ALTER TABLE "chat_input_queue" ADD CONSTRAINT "ck_chat_input_continuation" CHECK ((continuation_owner IS NULL AND continuation_phase IS NULL) OR (continuation_owner IS NOT NULL AND continuation_phase IS NOT NULL AND continuation_phase IN ('prepared','armed')));--> statement-breakpoint
ALTER TABLE "chat_thread" ADD CONSTRAINT "ck_chat_thread_origin" CHECK (created_execution_origin IS NULL OR created_execution_origin IN ('web_cloud','mobile_ios','mobile_android'));
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability,version,contract_sha256,adopted_from,metadata) VALUES ('dream.chat-continuation.v1',1,'86bc59653c2f5d68a77cc4d922f1f4ebb670599411af6e4d3a64a93db814c3a8','0086_chat_continuation','{"phase":"expand","legacy_origin":null,"owner":"Admin Drizzle"}'::jsonb);
