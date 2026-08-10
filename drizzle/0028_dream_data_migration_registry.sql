CREATE TABLE "drizzle"."data_migration_definitions" (
  "migration_key" text PRIMARY KEY NOT NULL,
  "owner" text NOT NULL,
  "runner_contract" text NOT NULL,
  "runner_path" text NOT NULL,
  "expected_table_count" integer,
  "expected_source_row_count" bigint,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "data_migration_definitions_owner_check"
    CHECK ("owner" IN ('dream', 'admin')),
  CONSTRAINT "data_migration_definitions_counts_check"
    CHECK (
      ("expected_table_count" IS NULL OR "expected_table_count" >= 0)
      AND ("expected_source_row_count" IS NULL OR "expected_source_row_count" >= 0)
    ),
  CONSTRAINT "data_migration_definitions_metadata_check"
    CHECK (jsonb_typeof("metadata") = 'object')
);
--> statement-breakpoint
CREATE TABLE "drizzle"."data_migration_runs" (
  "run_id" uuid PRIMARY KEY NOT NULL,
  "migration_key" text NOT NULL,
  "status" text NOT NULL,
  "runner_mode" text NOT NULL,
  "manifest_sha256" text,
  "source_fingerprint_sha256" text NOT NULL,
  "source_table_count" integer DEFAULT 0 NOT NULL,
  "source_row_count" bigint DEFAULT 0 NOT NULL,
  "inserted_row_count" bigint DEFAULT 0 NOT NULL,
  "verified_source_pk_count" bigint DEFAULT 0 NOT NULL,
  "exact_matched_row_count" bigint DEFAULT 0 NOT NULL,
  "post_cutover_changed_row_count" bigint DEFAULT 0 NOT NULL,
  "target_extra_row_count" bigint DEFAULT 0 NOT NULL,
  "summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "completed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "data_migration_runs_status_check"
    CHECK ("status" IN (
      'validated_source', 'validated_target', 'committed', 'adopted_exact',
      'adopted_with_post_cutover_changes', 'seeded', 'failed'
    )),
  CONSTRAINT "data_migration_runs_counts_check"
    CHECK (
      "source_table_count" >= 0 AND "source_row_count" >= 0
      AND "inserted_row_count" >= 0 AND "verified_source_pk_count" >= 0
      AND "exact_matched_row_count" >= 0
      AND "post_cutover_changed_row_count" >= 0
      AND "target_extra_row_count" >= 0
    ),
  CONSTRAINT "data_migration_runs_summary_check"
    CHECK (jsonb_typeof("summary") = 'object')
);
--> statement-breakpoint
CREATE TABLE "drizzle"."data_migration_table_results" (
  "run_id" uuid NOT NULL,
  "source_database" text NOT NULL,
  "table_name" text NOT NULL,
  "source_count" bigint NOT NULL,
  "target_count" bigint,
  "inserted_count" bigint DEFAULT 0 NOT NULL,
  "verified_primary_key_count" bigint DEFAULT 0 NOT NULL,
  "exact_matched_count" bigint DEFAULT 0 NOT NULL,
  "post_cutover_changed_count" bigint DEFAULT 0 NOT NULL,
  "target_extra_count" bigint DEFAULT 0 NOT NULL,
  "source_pk_sha256" text NOT NULL,
  "source_row_sha256" text NOT NULL,
  "target_pk_sha256" text,
  "target_row_sha256" text,
  "changed_columns" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "data_migration_table_results_pk"
    PRIMARY KEY ("run_id", "source_database", "table_name"),
  CONSTRAINT "data_migration_table_results_source_check"
    CHECK ("source_database" IN ('main', 'notion')),
  CONSTRAINT "data_migration_table_results_counts_check"
    CHECK (
      "source_count" >= 0 AND ("target_count" IS NULL OR "target_count" >= 0)
      AND "inserted_count" >= 0 AND "verified_primary_key_count" >= 0
      AND "exact_matched_count" >= 0 AND "post_cutover_changed_count" >= 0
      AND "target_extra_count" >= 0
    ),
  CONSTRAINT "data_migration_table_results_changed_columns_check"
    CHECK (jsonb_typeof("changed_columns") = 'object')
);
--> statement-breakpoint
ALTER TABLE "drizzle"."data_migration_runs"
  ADD CONSTRAINT "data_migration_runs_definition_fk"
  FOREIGN KEY ("migration_key")
  REFERENCES "drizzle"."data_migration_definitions"("migration_key")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "drizzle"."data_migration_table_results"
  ADD CONSTRAINT "data_migration_table_results_run_fk"
  FOREIGN KEY ("run_id")
  REFERENCES "drizzle"."data_migration_runs"("run_id")
  ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "data_migration_successful_source_uidx"
  ON "drizzle"."data_migration_runs" (
    "migration_key", "source_fingerprint_sha256"
  )
  WHERE "status" IN (
    'committed', 'adopted_exact', 'adopted_with_post_cutover_changes', 'seeded'
  );
--> statement-breakpoint
CREATE INDEX "data_migration_runs_completed_idx"
  ON "drizzle"."data_migration_runs" ("migration_key", "completed_at");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "drizzle"."prevent_data_migration_history_mutation"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Drizzle data migration history is append-only'
    USING ERRCODE = '55000',
          CONSTRAINT = 'drizzle_data_migration_history_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "data_migration_definitions_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "drizzle"."data_migration_definitions"
FOR EACH ROW EXECUTE FUNCTION "drizzle"."prevent_data_migration_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "data_migration_runs_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "drizzle"."data_migration_runs"
FOR EACH ROW EXECUTE FUNCTION "drizzle"."prevent_data_migration_history_mutation"();
--> statement-breakpoint
CREATE TRIGGER "data_migration_table_results_no_update_or_delete"
BEFORE UPDATE OR DELETE ON "drizzle"."data_migration_table_results"
FOR EACH ROW EXECUTE FUNCTION "drizzle"."prevent_data_migration_history_mutation"();
--> statement-breakpoint
INSERT INTO "drizzle"."data_migration_definitions" (
  "migration_key", "owner", "runner_contract", "runner_path",
  "expected_table_count", "expected_source_row_count", "metadata"
) VALUES (
  'dream-legacy-43-plus-5-v1',
  'dream',
  'ink-dream-legacy-postgres-import-v1',
  'drizzle/data/legacy-43-plus-5.mjs',
  48,
  4921,
  '{"mainTables":43,"notionTables":5,"ddlOwner":"dream-alembic","dataOwner":"dream"}'::jsonb
), (
  'default-dream-plans-v1',
  'admin',
  'ink-admin-default-dream-plans-v1',
  'drizzle/data/default-dream-plans.mjs',
  NULL,
  NULL,
  '{"plans":["free","dream","is-dreaming"],"billingPeriod":"monthly","valueUnit":"token"}'::jsonb
);
--> statement-breakpoint
INSERT INTO "subscription_plans" (
  "id", "code", "name", "display_eyebrow", "display_note",
  "display_details", "status"
) VALUES
  (
    'plan_default_free', 'free', 'Free', 'A quiet beginning',
    '从一段创作目标开始',
    '["查看已有 Deck","发起有限次数的 Dream","保留最近的工作台入口"]'::jsonb,
    'active'
  ),
  (
    'plan_default_dream', 'dream', 'Dream', 'For active stories',
    '给持续创作留出空间',
    '["更充足的 Dream 创作额度","更长的 Dream Agent 对话历史","优先体验新的创作工作台能力"]'::jsonb,
    'active'
  ),
  (
    'plan_default_is_dreaming', 'is-dreaming', 'is Dreaming',
    'For ongoing worlds', '为长期作品准备的工作台',
    '["面向多部作品的持续创作支持","更完整的 Deck 与工作台协作空间","适合正在形成中的故事世界"]'::jsonb,
    'active'
  )
ON CONFLICT ("code") DO NOTHING;
--> statement-breakpoint
DO $$
DECLARE
  conflict_count integer;
BEGIN
  SELECT count(*) INTO conflict_count
  FROM (VALUES
    ('free', 'Free', 'A quiet beginning', '从一段创作目标开始',
      '["查看已有 Deck","发起有限次数的 Dream","保留最近的工作台入口"]'::jsonb),
    ('dream', 'Dream', 'For active stories', '给持续创作留出空间',
      '["更充足的 Dream 创作额度","更长的 Dream Agent 对话历史","优先体验新的创作工作台能力"]'::jsonb),
    ('is-dreaming', 'is Dreaming', 'For ongoing worlds', '为长期作品准备的工作台',
      '["面向多部作品的持续创作支持","更完整的 Deck 与工作台协作空间","适合正在形成中的故事世界"]'::jsonb)
  ) AS expected(code, name, eyebrow, note, details)
  LEFT JOIN subscription_plans AS plan ON plan.code = expected.code
  WHERE plan.id IS NULL
     OR plan.name IS DISTINCT FROM expected.name
     OR plan.display_eyebrow IS DISTINCT FROM expected.eyebrow
     OR plan.display_note IS DISTINCT FROM expected.note
     OR plan.display_details IS DISTINCT FROM expected.details
     OR plan.status IS DISTINCT FROM 'active';

  IF conflict_count <> 0 THEN
    RAISE EXCEPTION 'Default Dream plan identity conflicts with existing data'
      USING ERRCODE = '23514',
            CONSTRAINT = 'default_dream_plan_identity_check';
  END IF;
END;
$$;
--> statement-breakpoint
INSERT INTO "subscription_plan_versions" (
  "id", "plan_id", "version_number", "status", "billing_period",
  "base_price_microusd", "allowance_tokens", "allowance_microusd",
  "overage_policy", "effective_from"
)
SELECT seed.version_id, plan.id, 1, 'draft', 'monthly', 0,
       seed.allowance_tokens, 0, 'deny', NULL
FROM (VALUES
  ('free', 'planv_default_free_v1', 100000::bigint),
  ('dream', 'planv_default_dream_v1', 0::bigint),
  ('is-dreaming', 'planv_default_is_dreaming_v1', 0::bigint)
) AS seed(plan_code, version_id, allowance_tokens)
JOIN subscription_plans AS plan ON plan.code = seed.plan_code
WHERE NOT EXISTS (
  SELECT 1 FROM subscription_plan_versions AS existing
  WHERE existing.plan_id = plan.id
);
--> statement-breakpoint
COMMENT ON TABLE "drizzle"."data_migration_runs" IS
  'Append-only redacted receipts for external data migrations; never stores source paths, DSNs, Secrets or business values.';
--> statement-breakpoint
COMMENT ON TABLE "drizzle"."data_migration_table_results" IS
  'Per-table counts and digests for the Dream 43+5 migration and adoption verification.';
