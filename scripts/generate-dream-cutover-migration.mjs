import { readFile, writeFile } from "node:fs/promises";

import { canonicalDreamSchemaJson } from "./lib/dream-schema-contract.mjs";

const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0 || index + 1 >= args.length) {
    throw new Error(`${name} is required`);
  }
  return args[index + 1];
};
if (args.length !== 6) {
  throw new Error(
    "Usage: node scripts/generate-dream-cutover-migration.mjs --contract <json> --bootstrap <json> --output <sql>",
  );
}

const contract = JSON.parse(await readFile(option("--contract"), "utf8"));
const bootstrap = JSON.parse(await readFile(option("--bootstrap"), "utf8"));
if (!Array.isArray(bootstrap) || bootstrap.length < 100) {
  throw new Error("Dream bootstrap statement inventory is incomplete");
}
const expectedNames = contract.tableNames;
const baselineNames = [
  "story_workspace_stories",
  "story_workspace_workspaces",
  "users",
];
const fullCatalog = structuredClone(contract.catalog);
const baselineCatalog = {
  tables: fullCatalog.tables.filter((table) => baselineNames.includes(table.name)),
};
const alembic06Catalog = structuredClone(fullCatalog);
const workflowRuns = alembic06Catalog.tables.find((table) => table.name === "workflow_runs");
if (!workflowRuns) throw new Error("Dream contract is missing workflow_runs");
const before = workflowRuns.indexes.length;
workflowRuns.indexes = workflowRuns.indexes.filter(
  (index) => index.name !== "idx_workflow_runs_source_voice_thread",
);
if (workflowRuns.indexes.length !== before - 1) {
  throw new Error("Dream contract does not contain the 20260811_07 lookup index");
}

const sqlArray = (values) => `ARRAY[${values.map((value) => `'${value}'`).join(",")}]::text[]`;
const jsonLiteral = (value, tag) => {
  const serialized = canonicalDreamSchemaJson(value);
  if (serialized.includes(`$${tag}$`)) throw new Error(`unsafe ${tag} JSON delimiter`);
  return `$${tag}$${serialized}$${tag}$::jsonb`;
};
const quoteExecution = (statement, index) => {
  const tag = `dream_ddl_${String(index).padStart(3, "0")}`;
  if (statement.includes(`$${tag}$`)) throw new Error(`unsafe DDL delimiter ${tag}`);
  return `    EXECUTE $${tag}$${statement}$${tag}$;`;
};

const catalogFunction = `CREATE FUNCTION pg_temp.dream_schema_contract(p_table_names text[])
RETURNS jsonb
LANGUAGE sql
STABLE
AS $dream_contract_function$
  WITH selected_tables AS (
    SELECT c.oid, c.relname AS table_name
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public'
       AND c.relkind IN ('r','p')
       AND c.relname=ANY(p_table_names)
  ), table_contracts AS (
    SELECT st.table_name,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'ordinal', a.attnum,
          'name', a.attname,
          'type', pg_catalog.format_type(a.atttypid, a.atttypmod),
          'notNull', a.attnotnull,
          'identity', nullif(a.attidentity, ''),
          'default', pg_catalog.pg_get_expr(ad.adbin, ad.adrelid, true)
        ) ORDER BY a.attnum)
        FROM pg_catalog.pg_attribute a
        LEFT JOIN pg_catalog.pg_attrdef ad
          ON ad.adrelid=a.attrelid AND ad.adnum=a.attnum
        WHERE a.attrelid=st.oid AND a.attnum>0 AND NOT a.attisdropped
      ), '[]'::jsonb) AS columns,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', con.conname,
          'type', con.contype,
          'definition', pg_catalog.pg_get_constraintdef(con.oid, true),
          'validated', con.convalidated
        ) ORDER BY con.contype, con.conname)
        FROM pg_catalog.pg_constraint con
        WHERE con.conrelid=st.oid AND con.contype IN ('p','u','c','f')
      ), '[]'::jsonb) AS constraints,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', ic.relname,
          'definition', pg_catalog.pg_get_indexdef(i.indexrelid),
          'valid', i.indisvalid
        ) ORDER BY ic.relname)
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class ic ON ic.oid=i.indexrelid
        LEFT JOIN pg_catalog.pg_constraint con ON con.conindid=i.indexrelid
        WHERE i.indrelid=st.oid AND con.oid IS NULL
      ), '[]'::jsonb) AS indexes,
      COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'name', tg.tgname,
          'definition', pg_catalog.pg_get_triggerdef(tg.oid, true),
          'function', pg_catalog.pg_get_functiondef(proc.oid)
        ) ORDER BY tg.tgname)
        FROM pg_catalog.pg_trigger tg
        JOIN pg_catalog.pg_proc proc ON proc.oid=tg.tgfoid
        WHERE tg.tgrelid=st.oid AND NOT tg.tgisinternal
      ), '[]'::jsonb) AS triggers
    FROM selected_tables st
  )
  SELECT jsonb_build_object(
    'tables', COALESCE(jsonb_agg(jsonb_build_object(
      'name', table_name,
      'columns', columns,
      'constraints', constraints,
      'indexes', indexes,
      'triggers', triggers
    ) ORDER BY table_name), '[]'::jsonb)
  )
  FROM table_contracts
$dream_contract_function$`;

const preflight = `DO $dream_cutover_preflight$
DECLARE
  expected_names constant text[] := ${sqlArray(expectedNames)};
  baseline_names constant text[] := ${sqlArray(baselineNames)};
  present_names text[];
  legacy_rows integer;
  legacy_head text;
  mode text;
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname='public'
       AND c.relname=ANY(expected_names)
       AND c.relkind NOT IN ('r','p')
  ) THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DREAM_SCHEMA_RELATION_KIND_MISMATCH';
  END IF;

  SELECT COALESCE(array_agg(c.relname::text ORDER BY c.relname), ARRAY[]::text[])
    INTO present_names
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relkind IN ('r','p')
     AND c.relname=ANY(expected_names);

  IF to_regclass('public.dream_alembic_version') IS NULL THEN
    legacy_rows := 0;
    legacy_head := NULL;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname='dream_alembic_version' AND c.relkind='r'
    ) THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DREAM_ALEMBIC_LEDGER_KIND_MISMATCH';
    END IF;
    EXECUTE 'SELECT count(*)::int, min(version_num)::text FROM public.dream_alembic_version'
      INTO legacy_rows, legacy_head;
  END IF;

  IF present_names=baseline_names THEN
    IF legacy_rows<>0 OR pg_temp.dream_schema_contract(baseline_names) <>
      ${jsonLiteral(baselineCatalog, "dream_baseline_contract")}
    THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DREAM_SCHEMA_BASELINE_DRIFT';
    END IF;
    mode := 'fresh';
  ELSIF present_names=expected_names THEN
    IF legacy_rows<>1 OR legacy_head NOT IN ('20260809_06','20260811_07') THEN
      RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DREAM_SCHEMA_UNKNOWN_ALEMBIC_HEAD';
    END IF;
    IF legacy_head='20260809_06' THEN
      IF pg_temp.dream_schema_contract(expected_names) =
        ${jsonLiteral(alembic06Catalog, "dream_alembic_06_contract")}
      THEN
        mode := 'alembic_06_missing_index';
      ELSIF pg_temp.dream_schema_contract(expected_names) =
        ${jsonLiteral(fullCatalog, "dream_alembic_06_complete_contract")}
      THEN
        mode := 'alembic_06_existing_index';
      ELSE
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DREAM_SCHEMA_ALEMBIC_06_DRIFT';
      END IF;
    ELSE
      IF pg_temp.dream_schema_contract(expected_names) <>
        ${jsonLiteral(fullCatalog, "dream_alembic_07_contract")}
      THEN
        RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DREAM_SCHEMA_ALEMBIC_07_DRIFT';
      END IF;
      mode := 'alembic_07';
    END IF;
  ELSE
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DREAM_SCHEMA_PARTIAL_OR_UNKNOWN_BASELINE';
  END IF;
  PERFORM pg_catalog.set_config('ink.dream_schema_cutover_mode', mode, true);
END
$dream_cutover_preflight$`;

const bootstrapBlock = `DO $dream_cutover_bootstrap$
BEGIN
  IF current_setting('ink.dream_schema_cutover_mode', true)='fresh' THEN
${bootstrap.map(quoteExecution).join("\n")}
  ELSIF current_setting('ink.dream_schema_cutover_mode', true)='alembic_06_missing_index' THEN
    EXECUTE $dream_thread_lookup$CREATE INDEX idx_workflow_runs_source_voice_thread ON workflow_runs (source_voice_thread_id)$dream_thread_lookup$;
  ELSIF current_setting('ink.dream_schema_cutover_mode', true) NOT IN ('alembic_06_existing_index','alembic_07') THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DREAM_SCHEMA_CUTOVER_MODE_MISSING';
  END IF;
END
$dream_cutover_bootstrap$`;

const postflight = `DO $dream_cutover_postflight$
BEGIN
  IF pg_temp.dream_schema_contract(${sqlArray(expectedNames)}) <>
    ${jsonLiteral(fullCatalog, "dream_final_contract")}
  THEN
    RAISE EXCEPTION USING ERRCODE='55000', MESSAGE='DREAM_SCHEMA_POSTFLIGHT_MISMATCH';
  END IF;
END
$dream_cutover_postflight$`;

const capabilityTable = `CREATE TABLE "drizzle"."schema_capabilities" (
  "capability" text PRIMARY KEY NOT NULL,
  "version" integer NOT NULL,
  "contract_sha256" text NOT NULL,
  "adopted_from" text NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  CONSTRAINT "schema_capabilities_version_check" CHECK ("version" >= 1),
  CONSTRAINT "schema_capabilities_contract_sha256_check"
    CHECK ("contract_sha256" ~ '^[0-9a-f]{64}$')
)`;

const capabilities = `INSERT INTO "drizzle"."schema_capabilities" (
  capability, version, contract_sha256, adopted_from, metadata
) VALUES
  ('dream.schema.unified.v1', 1, '${contract.catalogSha256}',
    current_setting('ink.dream_schema_cutover_mode'),
    '{"dreamCore":{"tables":48,"columns":569,"explicitIndexes":82,"triggers":25},"physical":{"tables":48,"columns":584,"explicitIndexes":85,"triggers":28}}'::jsonb),
  ('dream.workflow.thread-lookup.v1', 1, '${contract.catalogSha256}',
    current_setting('ink.dream_schema_cutover_mode'), '{}'::jsonb),
  ('dream.story-artifact-contract.v2', 2, '${contract.catalogSha256}',
    current_setting('ink.dream_schema_cutover_mode'), '{}'::jsonb)`;

const legacyDataDefinition = `INSERT INTO "drizzle"."data_migration_definitions" (
  "migration_key", "owner", "runner_contract", "runner_path",
  "expected_table_count", "expected_source_row_count", "metadata"
) VALUES (
  'dream-legacy-43-plus-5-v2-drizzle',
  'dream',
  'ink-dream-legacy-postgres-import-v1',
  'drizzle/data/legacy-43-plus-5.mjs',
  48,
  NULL,
  '{"mainTables":43,"notionTables":5,"ddlOwner":"admin-drizzle","dataOwner":"dream","requiresCapability":"dream.schema.unified.v1","supersedes":"dream-legacy-43-plus-5-v1"}'::jsonb
)`;

const generated = `-- Generated, then reviewed, from the isolated PostgreSQL 16 contract
-- drizzle/contracts/current-catalog.json (${contract.catalogSha256}).
-- This is the one-way DDL authority cutover. Historical migrations remain immutable.
-- Destructive data/schema operations and owner/ACL mutations are forbidden here.

${catalogFunction};
--> statement-breakpoint
${preflight};
--> statement-breakpoint
${bootstrapBlock};
--> statement-breakpoint
${postflight};
--> statement-breakpoint
${capabilityTable};
--> statement-breakpoint
${capabilities};
--> statement-breakpoint
${legacyDataDefinition};
`;

const executableSql = generated.replace(/^\s*--.*$/gm, "");
if (/\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(executableSql)) {
  throw new Error("Generated cutover contains a destructive operation");
}
if (/\b(?:CREATE|ALTER)\b[^;]*\bIF\s+(?:NOT\s+)?EXISTS\b/i.test(executableSql)) {
  throw new Error("Generated cutover masks schema drift with an existence clause");
}
await writeFile(option("--output"), generated, { flag: "wx" });
console.log(JSON.stringify({
  output: option("--output"),
  bootstrapStatements: bootstrap.length,
  catalogSha256: contract.catalogSha256,
}));
