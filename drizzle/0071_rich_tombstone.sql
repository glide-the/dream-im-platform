-- [Input] 0069 trigger history and 0070 claim-bound Runtime grants.
-- [Output] Explicit target turn binding and exact completion capability.
-- [Pos] Forward expansion; existing trigger rows remain nullable until a worker starts their model turn.
-- [Sync] 2026-09-28: bind turn ID before model invocation so final recovery never guesses from a Thread.
ALTER TABLE "chat_scheduled_trigger" ADD COLUMN "target_turn_id" text;--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "uq_chat_scheduled_trigger_turn" UNIQUE("target_turn_id");--> statement-breakpoint
ALTER TABLE "chat_scheduled_trigger" ADD CONSTRAINT "ck_chat_scheduled_trigger_turn" CHECK (status <> 'running' OR target_turn_id IS NOT NULL);
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('dream.chat-scheduled-turn-binding.v1', 1, '67c8f545d4c4ba4eaaf32f7f5eb281c26b1a27da1a0c26fa517c1c93cdbb7482', 'admin-drizzle-0071', '{"table":"public.chat_scheduled_trigger","column":"target_turn_id","final":"chat_message.metadata.turnId"}'::jsonb);
