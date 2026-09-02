-- [Input] Dream Chat history keyset pagination ordered by thread, created_at, and message id.
-- [Output] Additive stable-order index plus the exact cross-service pagination capability receipt.
-- [Pos] Sole forward PostgreSQL DDL owner for dream.chat-history-keyset-pagination.v1.
-- [Sync] 2026-09-02: publish the keyset ordering contract after the supporting index exists.

CREATE INDEX "idx_chat_message_thread_created_id_desc"
  ON "chat_message" USING btree (
    "thread_id",
    "created_at" DESC NULLS LAST,
    "id" DESC NULLS LAST
  );
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (
  capability,
  version,
  contract_sha256,
  adopted_from,
  metadata
) VALUES (
  'dream.chat-history-keyset-pagination.v1',
  1,
  'a0dfe5f8d4b4330a9e17db07a8716d5d2bc25e291f3624f09005e79c01fc8ab0',
  'admin-drizzle-0042',
  '{"covering":false,"direction":"older","index":"idx_chat_message_thread_created_id_desc","order":["created_at DESC NULLS LAST","id DESC"],"table":"public.chat_message"}'::jsonb
);
