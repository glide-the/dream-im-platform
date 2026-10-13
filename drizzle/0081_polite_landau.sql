-- [Input] Existing Reflections task table and immutable forward Drizzle journal.
-- [Output] Nullable private analysis input and its exact capability in one transaction.
-- [Pos] Additive expand migration; legacy null retains the original diary task path.
-- [Sync] 2026-10-13: publish task-private Notion/Agent input without changing historical DTOs.
ALTER TABLE "reflection_task" ADD COLUMN "analysis_content_json" text;
--> statement-breakpoint
INSERT INTO drizzle.schema_capabilities (capability, version, contract_sha256, adopted_from, metadata) VALUES ('dream.reflection-analysis-content.v1', 1, '29e5fbc327dff07c65ce4be8be1e42e520f0408b38062ecfdaec866838d55afe', 'admin-drizzle-0081', '{"phase":"expand","input":"immutable-task-private","legacy":"null-default-diary"}'::jsonb);
