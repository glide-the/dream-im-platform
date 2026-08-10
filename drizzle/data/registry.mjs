import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

export const LEGACY_MIGRATION_KEY = "dream-legacy-43-plus-5-v1";
export const PLAN_SEED_KEY = "default-dream-plans-v1";

const SUCCESS_STATUSES = new Set([
  "committed",
  "adopted_exact",
  "adopted_with_post_cutover_changes",
  "seeded",
]);

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nonNegative(value, fallback = 0) {
  const selected = value ?? fallback;
  if (!Number.isSafeInteger(Number(selected)) || Number(selected) < 0) {
    throw new Error("Data migration receipt contains an invalid count");
  }
  return String(selected);
}

function assertSafeLegacyReceipt(receipt) {
  if (receipt?.contract !== "ink-dream-legacy-postgres-import-v1") {
    throw new Error("Unexpected Dream data migration contract");
  }
  if (receipt?.validation?.tables !== 48 || receipt?.validation?.sourceRows !== 4921) {
    throw new Error("Dream data migration source inventory is not 48 tables / 4,921 rows");
  }
  if (receipt?.security?.containsBusinessValues !== false
    || receipt?.security?.containsSourcePaths !== false
    || receipt?.security?.containsDsn !== false
    || receipt?.security?.implicitOverwrite !== false
    || receipt?.security?.destructiveTargetCleanup !== false) {
    throw new Error("Dream data migration receipt failed its redaction/safety contract");
  }
  if (!Array.isArray(receipt.tables) || receipt.tables.length !== 48) {
    throw new Error("Dream data migration receipt does not contain 48 table results");
  }
}

async function existingRun(client, migrationKey, fingerprint) {
  const result = await client.query(
    `SELECT run_id::text, status
       FROM drizzle.data_migration_runs
      WHERE migration_key = $1
        AND source_fingerprint_sha256 = $2
        AND status IN (
          'committed', 'adopted_exact',
          'adopted_with_post_cutover_changes', 'seeded'
        )
      LIMIT 1`,
    [migrationKey, fingerprint],
  );
  return result.rows[0] ?? null;
}

async function record({
  databaseUrl,
  migrationKey,
  runnerContract,
  runId,
  status,
  runnerMode,
  manifestSha256 = null,
  sourceFingerprint,
  sourceTableCount = 0,
  sourceRowCount = 0,
  insertedRowCount = 0,
  verifiedSourcePkCount = 0,
  exactMatchedRowCount = 0,
  postCutoverChangedRowCount = 0,
  targetExtraRowCount = 0,
  summary,
  tables = [],
}) {
  if (!SUCCESS_STATUSES.has(status)) throw new Error("Unsupported successful migration status");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`drizzle-data:${migrationKey}`],
    );
    const definition = await client.query(
      `SELECT runner_contract, expected_table_count, expected_source_row_count
         FROM drizzle.data_migration_definitions
        WHERE migration_key = $1
        FOR SHARE`,
      [migrationKey],
    );
    const expected = definition.rows[0];
    if (!expected || expected.runner_contract !== runnerContract) {
      throw new Error("Drizzle data migration definition is missing or incompatible");
    }
    if (expected.expected_table_count !== null
      && Number(expected.expected_table_count) !== Number(sourceTableCount)) {
      throw new Error("Drizzle data migration table count does not match its definition");
    }
    if (expected.expected_source_row_count !== null
      && Number(expected.expected_source_row_count) !== Number(sourceRowCount)) {
      throw new Error("Drizzle data migration row count does not match its definition");
    }

    const previous = await existingRun(client, migrationKey, sourceFingerprint);
    if (previous) {
      await client.query("ROLLBACK");
      return { recorded: false, reused: true, runId: previous.run_id, status: previous.status };
    }

    await client.query(
      `INSERT INTO drizzle.data_migration_runs (
         run_id, migration_key, status, runner_mode, manifest_sha256,
         source_fingerprint_sha256, source_table_count, source_row_count,
         inserted_row_count, verified_source_pk_count, exact_matched_row_count,
         post_cutover_changed_row_count, target_extra_row_count, summary
       ) VALUES (
         $1::uuid,$2,$3,$4,$5,$6,$7::integer,$8::bigint,$9::bigint,$10::bigint,
         $11::bigint,$12::bigint,$13::bigint,$14::jsonb
       )`,
      [
        runId, migrationKey, status, runnerMode, manifestSha256, sourceFingerprint,
        Number(sourceTableCount), nonNegative(sourceRowCount), nonNegative(insertedRowCount),
        nonNegative(verifiedSourcePkCount), nonNegative(exactMatchedRowCount),
        nonNegative(postCutoverChangedRowCount), nonNegative(targetExtraRowCount),
        JSON.stringify(summary),
      ],
    );

    for (const table of tables) {
      await client.query(
        `INSERT INTO drizzle.data_migration_table_results (
           run_id, source_database, table_name, source_count, target_count,
           inserted_count, verified_primary_key_count, exact_matched_count,
           post_cutover_changed_count, target_extra_count,
           source_pk_sha256, source_row_sha256, target_pk_sha256,
           target_row_sha256, changed_columns
         ) VALUES (
           $1::uuid,$2,$3,$4::bigint,$5::bigint,$6::bigint,$7::bigint,$8::bigint,
           $9::bigint,$10::bigint,$11,$12,$13,$14,$15::jsonb
         )`,
        [
          runId, table.source, table.table, nonNegative(table.sourceCount),
          table.targetCount === undefined ? null : nonNegative(table.targetCount),
          nonNegative(table.inserted),
          nonNegative(table.verifiedPrimaryKeyCount ?? table.verifiedSubsetCount),
          nonNegative(table.exactMatchedCount ?? table.verifiedSubsetCount),
          nonNegative(table.postCutoverChangedCount), nonNegative(table.targetExtraCount),
          table.pkSha256, table.rowSha256, table.targetPkSha256 ?? null,
          table.targetRowSha256 ?? null, JSON.stringify(table.changedColumns ?? {}),
        ],
      );
    }
    await client.query("COMMIT");
    return { recorded: true, reused: false, runId, status };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export async function recordLegacyReceipt(databaseUrl, receipt) {
  assertSafeLegacyReceipt(receipt);
  const status = receipt.status;
  if (!new Set([
    "committed", "adopted_exact", "adopted_with_post_cutover_changes",
  ]).has(status)) {
    throw new Error("Only committed or explicitly adopted Dream runs can be recorded");
  }
  const sourceFingerprint = sha256Json({
    contract: receipt.contract,
    manifestSha256: receipt.manifestSha256,
    tables: receipt.tables
      .map((table) => ({
        source: table.source,
        table: table.table,
        sourceCount: table.sourceCount,
        pkSha256: table.pkSha256,
        rowSha256: table.rowSha256,
      }))
      .sort((left, right) => `${left.source}:${left.table}`
        .localeCompare(`${right.source}:${right.table}`)),
  });
  const target = receipt.target ?? {};
  return record({
    databaseUrl,
    migrationKey: LEGACY_MIGRATION_KEY,
    runnerContract: receipt.contract,
    runId: receipt.runId,
    status,
    runnerMode: receipt.mode,
    manifestSha256: receipt.manifestSha256,
    sourceFingerprint,
    sourceTableCount: receipt.validation.tables,
    sourceRowCount: receipt.validation.sourceRows,
    insertedRowCount: target.insertedRows,
    verifiedSourcePkCount: target.verifiedSourcePrimaryKeys
      ?? receipt.validation.sourceRows,
    exactMatchedRowCount: target.exactMatchedRows
      ?? receipt.validation.sourceRows,
    postCutoverChangedRowCount: target.postCutoverChangedRows,
    targetExtraRowCount: target.targetExtraRows,
    summary: {
      contract: receipt.contract,
      manifestSha256: receipt.manifestSha256,
      mainSnapshotSha256: receipt.source.main.snapshotSha256,
      notionSnapshotSha256: receipt.source.notion.snapshotSha256,
      sourceForeignKeyChecks: receipt.validation.sourceForeignKeyChecks,
      targetForeignKeyChecks: target.foreignKeyChecks ?? null,
      targetTransaction: target.transaction,
      redacted: true,
    },
    tables: receipt.tables,
  });
}

export async function recordPlanSeedReceipt(databaseUrl, receipt) {
  if (receipt?.mode !== "applied"
    || JSON.stringify(receipt.plans) !== JSON.stringify(["free", "dream", "is-dreaming"])) {
    throw new Error("Unexpected default Dream plan seed receipt");
  }
  const sourceFingerprint = sha256Json({
    contract: "ink-admin-default-dream-plans-v1",
    plans: receipt.plans,
    freePlanVersion: receipt.freePlanVersion,
    freeModelAlias: receipt.freeModelAlias,
    freeMonthlyTokens: receipt.freeMonthlyTokens,
  });
  return record({
    databaseUrl,
    migrationKey: PLAN_SEED_KEY,
    runnerContract: "ink-admin-default-dream-plans-v1",
    runId: randomUUID(),
    status: "seeded",
    runnerMode: "apply",
    sourceFingerprint,
    summary: {
      plans: receipt.plans,
      freePlanVersion: receipt.freePlanVersion,
      freeModelAlias: receipt.freeModelAlias,
      freeMonthlyTokens: receipt.freeMonthlyTokens,
      backfilledSubscriptions: receipt.backfilledSubscriptions,
      transitionedFreeSubscriptions: receipt.transitionedFreeSubscriptions,
      redacted: true,
    },
  });
}
