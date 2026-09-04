-- [Input] Canonical chat_message parts plus Dream's strict completed-assistant final projection contract.
-- [Output] Additive final-text/process/version columns, audited backfill definition, and exact Dream capability.
-- [Pos] Sole PostgreSQL expand owner for dream.chat-history-final-projection.v1.
-- [Sync] 2026-09-02: publish row-level final projection fields without rewriting canonical parts or moving business data in the schema migration.

-- Additive nullable/defaulted columns keep the pre-0043 Dream reader and writer
-- compatible during expand/backfill. The table takes the ordinary short ALTER
-- lock; the potentially large historical scan belongs to the explicit data runner.
ALTER TABLE "chat_message" ADD COLUMN "history_final_text" text;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "history_process_available" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_message" ADD COLUMN "history_projection_version" integer;--> statement-breakpoint
ALTER TABLE "chat_message" ADD CONSTRAINT "ck_chat_message_history_projection_v1" CHECK ((
		(history_projection_version IS NULL
			AND history_final_text IS NULL
			AND history_process_available = false)
		OR
		(history_projection_version = 1
			AND role = 'assistant'
			AND history_final_text IS NOT NULL
			AND btrim(history_final_text) <> '')
	));--> statement-breakpoint
INSERT INTO "drizzle"."data_migration_definitions" (
  "migration_key", "owner", "runner_contract", "runner_path",
  "expected_table_count", "expected_source_row_count", "metadata"
) VALUES (
  'chat-history-final-projection-v1',
  'admin',
  'ink-admin-chat-history-final-projection-v1',
  'drizzle/data/chat-history-final-projection.mjs',
  1,
  NULL,
  '{"table":"public.chat_message","canonicalColumn":"parts","projectionVersion":1,"defaultMode":"dry-run","containsBusinessValues":false}'::jsonb
);--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (
  capability,
  version,
  contract_sha256,
  adopted_from,
  metadata
) VALUES (
  'dream.chat-history-final-projection.v1',
  1,
  '50c27f86113c170064b0913bf052f9bd12884d3345c920d7b11468a768e0a432',
  'admin-drizzle-0043',
  '{"table":"public.chat_message","columns":["history_final_text","history_process_available","history_projection_version"],"canonical":"parts","detail":"thread-and-assistant-message-id","backfill":"drizzle/data/chat-history-final-projection.mjs"}'::jsonb
);
