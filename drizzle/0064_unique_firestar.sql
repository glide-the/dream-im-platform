-- [Input] Admin-owned Chat user messages and Thread identity.
-- [Output] Additive durable queue table and dream.chat-input-queue.v1 capability.
-- [Pos] Sole shared PostgreSQL schema owner for Dream Agent input queue.
-- [Sync] 2026-09-26: queue order and revisioned dispatch state are persisted separately from immutable Chat messages.
CREATE TABLE "chat_input_queue" (
	"message_id" text PRIMARY KEY NOT NULL,
	"thread_id" text NOT NULL,
	"queue_sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "chat_input_queue_queue_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"status" text DEFAULT 'queued' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"dispatch_turn_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_chat_input_queue_sequence" UNIQUE("queue_sequence"),
	CONSTRAINT "ck_chat_input_queue_status" CHECK (status IN ('queued','selected','dispatching','consumed','cancelled','failed','state_unknown')),
	CONSTRAINT "ck_chat_input_queue_revision" CHECK (revision >= 1)
);
--> statement-breakpoint
ALTER TABLE "chat_input_queue" ADD CONSTRAINT "fk_chat_input_queue_message" FOREIGN KEY ("message_id") REFERENCES "public"."chat_message"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_input_queue" ADD CONSTRAINT "fk_chat_input_queue_thread" FOREIGN KEY ("thread_id") REFERENCES "public"."chat_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_chat_input_queue_thread_order" ON "chat_input_queue" USING btree ("thread_id","queue_sequence");
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata)
VALUES ('dream.chat-input-queue.v1', 1, '2bb2490d6c8220e9f14a5dd41732d0c60c10d08db5de2bc997aeceeca544a2e1',
  'admin-drizzle-0064', '{"table":"public.chat_input_queue","order":"queue_sequence","claim":"thread-row-lock-and-revision-cas"}'::jsonb);
