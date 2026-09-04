// [Input] Redacted receipts from explicit PostgreSQL data migration runners.
// [Output] Append-only drizzle.data_migration_runs/table_results records with capability and fingerprint checks.
// [Pos] Shared audit registry boundary for Admin-owned data migrations.
// [Sync] 2026-09-04: register Provider ownership cutovers and deleted-Provider orphan cleanup with aggregate-only receipts.
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

import { gatewayDefaultLimitsPolicy } from "../../config/gateway-default-limits.mjs";

export const LEGACY_MIGRATION_KEY_V1 = "dream-legacy-43-plus-5-v1";
export const LEGACY_MIGRATION_KEY = "dream-legacy-43-plus-5-v2-drizzle";
export const LEGACY_SCHEMA_CAPABILITY = "dream.schema.unified.v1";
export const PLAN_SEED_KEY = "default-dream-plans-v1";
export const GATEWAY_DEFAULT_LIMITS_KEY = gatewayDefaultLimitsPolicy.revision;
export const CHAT_HISTORY_FINAL_PROJECTION_KEY = "chat-history-final-projection-v1";
export const CHAT_HISTORY_FINAL_PROJECTION_CAPABILITY =
  "dream.chat-history-final-projection.v1";
export const PROVIDER_MANAGED_ACCOUNTS_KEY = "provider-managed-accounts-v1";
export const PROVIDER_MANAGED_ACCOUNTS_CONTRACT =
  "ink-admin-provider-managed-accounts-v1";
export const PROVIDER_OWNED_CREDENTIALS_KEY = "provider-owned-credentials-v1";
export const PROVIDER_OWNED_CREDENTIALS_CONTRACT =
  "ink-admin-provider-owned-credentials-v1";
export const PROVIDER_DELETED_CREDENTIAL_ORPHANS_KEY =
  "provider-deleted-credential-orphans-v1";
export const PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT =
  "ink-admin-provider-deleted-credential-orphans-v1";

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
  if (receipt?.validation?.tables !== 48
    || !Number.isSafeInteger(receipt?.validation?.sourceRows)
    || receipt.validation.sourceRows < 0) {
    throw new Error("Dream data migration source inventory is invalid");
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
  const digestPattern = /^[0-9a-f]{64}$/;
  const sourceRows = receipt.tables.reduce((total, table) => {
    if (!Number.isSafeInteger(table?.sourceCount) || table.sourceCount < 0
      || !digestPattern.test(String(table?.pkSha256 ?? ""))
      || !digestPattern.test(String(table?.rowSha256 ?? ""))) {
      throw new Error("Dream data migration table receipt is invalid");
    }
    return total + table.sourceCount;
  }, 0);
  if (sourceRows !== receipt.validation.sourceRows
    || !digestPattern.test(String(receipt.manifestSha256 ?? ""))) {
    throw new Error("Dream data migration receipt digests or row totals are invalid");
  }
}

async function existingRun(client, migrationKeys, fingerprint) {
  const result = await client.query(
    `SELECT run_id::text, migration_key, status
       FROM drizzle.data_migration_runs
      WHERE migration_key = ANY($1::text[])
        AND source_fingerprint_sha256 = $2
        AND status IN (
          'committed', 'adopted_exact',
          'adopted_with_post_cutover_changes', 'seeded'
        )
      ORDER BY completed_at, run_id
      LIMIT 1`,
    [migrationKeys, fingerprint],
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
  reuseMigrationKeys = [migrationKey],
  requiredCapability = null,
}) {
  if (!SUCCESS_STATUSES.has(status)) throw new Error("Unsupported successful migration status");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [`drizzle-data:${reuseMigrationKeys.join(":")}`],
    );

    const previous = await existingRun(client, reuseMigrationKeys, sourceFingerprint);
    if (previous) {
      await client.query("ROLLBACK");
      return {
        recorded: false,
        reused: true,
        runId: previous.run_id,
        migrationKey: previous.migration_key,
        status: previous.status,
      };
    }

    if (requiredCapability) {
      const capability = await client.query(
        `SELECT version
           FROM drizzle.schema_capabilities
          WHERE capability = $1
          FOR SHARE`,
        [requiredCapability],
      );
      if (!capability.rows[0] || Number(capability.rows[0].version) < 1) {
        throw new Error("Required Dream schema capability is missing");
      }
    }

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
    return { recorded: true, reused: false, runId, migrationKey, status };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

export function legacySourceFingerprint(receipt) {
  return sha256Json({
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
}

export async function recordLegacyReceipt(databaseUrl, receipt) {
  assertSafeLegacyReceipt(receipt);
  const status = receipt.status;
  if (!new Set([
    "committed", "adopted_exact", "adopted_with_post_cutover_changes",
  ]).has(status)) {
    throw new Error("Only committed or explicitly adopted Dream runs can be recorded");
  }
  const sourceFingerprint = legacySourceFingerprint(receipt);
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
    reuseMigrationKeys: [LEGACY_MIGRATION_KEY, LEGACY_MIGRATION_KEY_V1],
    requiredCapability: LEGACY_SCHEMA_CAPABILITY,
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

export async function recordGatewayDefaultLimitsReceipt(databaseUrl, receipt) {
  if (receipt?.contract !== "ink-admin-gateway-default-token-limits-v1"
    || receipt?.mode !== "applied"
    || receipt?.revision !== GATEWAY_DEFAULT_LIMITS_KEY
    || receipt?.dailyTokenLimit !== gatewayDefaultLimitsPolicy.dailyTokenLimit
    || receipt?.monthlyTokenLimit !== gatewayDefaultLimitsPolicy.monthlyTokenLimit
    || !Number.isSafeInteger(receipt?.totalUsers)
    || receipt.totalUsers < 0
    || !Number.isSafeInteger(receipt?.changedUsers)
    || receipt.changedUsers < 0
    || receipt?.remainingMismatches !== 0
    || receipt?.missingCanonicalProjections !== 0) {
    throw new Error("Unexpected Gateway default-limit migration receipt");
  }
  const sourceFingerprint = sha256Json({
    contract: receipt.contract,
    revision: receipt.revision,
    dailyTokenLimit: receipt.dailyTokenLimit,
    monthlyTokenLimit: receipt.monthlyTokenLimit,
    totalUsers: receipt.totalUsers,
  });
  return record({
    databaseUrl,
    migrationKey: GATEWAY_DEFAULT_LIMITS_KEY,
    runnerContract: receipt.contract,
    runId: randomUUID(),
    status: "committed",
    runnerMode: "apply",
    sourceFingerprint,
    sourceTableCount: 1,
    sourceRowCount: receipt.totalUsers,
    exactMatchedRowCount: receipt.totalUsers,
    postCutoverChangedRowCount: receipt.changedUsers,
    summary: {
      revision: receipt.revision,
      dailyTokenLimit: receipt.dailyTokenLimit,
      monthlyTokenLimit: receipt.monthlyTokenLimit,
      totalUsers: receipt.totalUsers,
      changedUsers: receipt.changedUsers,
      remainingMismatches: receipt.remainingMismatches,
      missingCanonicalProjections: receipt.missingCanonicalProjections,
      effect: "429-only",
      redacted: true,
    },
  });
}

export async function recordChatHistoryFinalProjectionReceipt(databaseUrl, receipt) {
  if (receipt?.contract !== "ink-admin-chat-history-final-projection-v1"
    || receipt?.mode !== "applied"
    || !/^[0-9a-f]{64}$/.test(String(receipt?.sourceFingerprintSha256 ?? ""))
    || !Number.isSafeInteger(receipt?.totalAssistantRows)
    || receipt.totalAssistantRows < 0
    || !Number.isSafeInteger(receipt?.changedRows)
    || receipt.changedRows < 0
    || !Number.isSafeInteger(receipt?.projectedRows)
    || receipt.projectedRows < 0
    || !Number.isSafeInteger(receipt?.fallbackRows)
    || receipt.fallbackRows < 0
    || receipt?.remainingProjectableRows !== 0
    || receipt?.projectionVersion !== 1
    || receipt?.redacted !== true) {
    throw new Error("Unexpected Chat history final-projection migration receipt");
  }
  return record({
    databaseUrl,
    migrationKey: CHAT_HISTORY_FINAL_PROJECTION_KEY,
    runnerContract: receipt.contract,
    runId: randomUUID(),
    status: "committed",
    runnerMode: "apply",
    sourceFingerprint: receipt.sourceFingerprintSha256,
    sourceTableCount: 1,
    sourceRowCount: receipt.totalAssistantRows,
    exactMatchedRowCount: receipt.projectedRows,
    postCutoverChangedRowCount: receipt.changedRows,
    summary: {
      projectionVersion: receipt.projectionVersion,
      projectedRows: receipt.projectedRows,
      fallbackRows: receipt.fallbackRows,
      remainingProjectableRows: receipt.remainingProjectableRows,
      redacted: true,
    },
    requiredCapability: CHAT_HISTORY_FINAL_PROJECTION_CAPABILITY,
  });
}

export async function recordProviderManagedAccountsReceipt(databaseUrl, receipt) {
  const countFields = [
    "sourceRowCount",
    "providerRows",
    "credentialRows",
    "attemptRows",
    "revocationJobRows",
    "changedRows",
    "providerRowsChanged",
    "providersPinned",
    "providersFollowingDefault",
    "credentialRowsChanged",
    "credentialsReencrypted",
    "identitiesRehashed",
    "identitiesCleared",
    "attemptRowsChanged",
    "attemptsTerminated",
    "attemptContextsBackfilled",
    "revocationRowsChanged",
    "revocationJobsScoped",
  ];
  if (receipt?.contract !== PROVIDER_MANAGED_ACCOUNTS_CONTRACT
    || receipt?.mode !== "applied"
    || receipt?.sourceTableCount !== 4
    || !/^[0-9a-f]{64}$/.test(String(receipt?.sourceFingerprintSha256 ?? ""))
    || countFields.some((field) => (
      !Number.isSafeInteger(receipt?.[field]) || receipt[field] < 0
    ))
    || receipt.sourceRowCount !== receipt.providerRows
      + receipt.credentialRows + receipt.attemptRows + receipt.revocationJobRows
    || receipt.changedRows !== receipt.providerRowsChanged
      + receipt.credentialRowsChanged + receipt.attemptRowsChanged
      + receipt.revocationRowsChanged
    || receipt.remainingActiveAttempts !== 0
    || receipt.remainingNonTerminalRevocationJobs !== 0
    || receipt?.redacted !== true) {
    throw new Error("Unexpected Provider managed-account migration receipt");
  }
  return record({
    databaseUrl,
    migrationKey: PROVIDER_MANAGED_ACCOUNTS_KEY,
    runnerContract: PROVIDER_MANAGED_ACCOUNTS_CONTRACT,
    runId: randomUUID(),
    status: "committed",
    runnerMode: "apply",
    sourceFingerprint: receipt.sourceFingerprintSha256,
    sourceTableCount: receipt.sourceTableCount,
    sourceRowCount: receipt.sourceRowCount,
    verifiedSourcePkCount: receipt.sourceRowCount,
    exactMatchedRowCount: receipt.sourceRowCount,
    postCutoverChangedRowCount: receipt.changedRows,
    summary: {
      providerRows: receipt.providerRows,
      credentialRows: receipt.credentialRows,
      attemptRows: receipt.attemptRows,
      revocationJobRows: receipt.revocationJobRows,
      providersPinned: receipt.providersPinned,
      providersFollowingDefault: receipt.providersFollowingDefault,
      credentialsReencrypted: receipt.credentialsReencrypted,
      identitiesRehashed: receipt.identitiesRehashed,
      identitiesCleared: receipt.identitiesCleared,
      attemptsTerminated: receipt.attemptsTerminated,
      attemptContextsBackfilled: receipt.attemptContextsBackfilled,
      revocationJobsScoped: receipt.revocationJobsScoped,
      redacted: true,
    },
  });
}

export async function recordProviderOwnedCredentialsReceipt(databaseUrl, receipt) {
  const countFields = [
    "sourceRowCount",
    "providerRows",
    "credentialRows",
    "defaultRows",
    "attemptRows",
    "revocationJobRows",
    "changedRows",
    "providerRowsChanged",
    "credentialRowsChanged",
    "defaultRowsChanged",
    "providersDirectBound",
    "providersWithoutCredential",
    "credentialsReowned",
    "defaultsCleared",
    "liveCredentialRows",
    "disconnectedCredentialRows",
  ];
  if (receipt?.contract !== PROVIDER_OWNED_CREDENTIALS_CONTRACT
    || receipt?.mode !== "applied"
    || receipt?.sourceTableCount !== 5
    || !/^[0-9a-f]{64}$/.test(String(receipt?.sourceFingerprintSha256 ?? ""))
    || countFields.some((field) => (
      !Number.isSafeInteger(receipt?.[field]) || receipt[field] < 0
    ))
    || receipt.sourceRowCount !== receipt.providerRows
      + receipt.credentialRows + receipt.defaultRows
      + receipt.attemptRows + receipt.revocationJobRows
    || receipt.changedRows !== receipt.providerRowsChanged
      + receipt.credentialRowsChanged + receipt.defaultRowsChanged
    || receipt.defaultRowsChanged !== receipt.defaultRows
    || receipt.defaultsCleared !== receipt.defaultRows
    || receipt.credentialsReowned !== receipt.credentialRowsChanged
    || receipt.liveCredentialRows + receipt.disconnectedCredentialRows
      !== receipt.credentialRows
    || receipt.remainingSharedLiveCredentials !== 0
    || receipt.remainingOrphanLiveCredentials !== 0
    || receipt.remainingActiveAttempts !== 0
    || receipt.remainingNonTerminalRevocationJobs !== 0
    || receipt.credentialsCloned !== 0
    || receipt.credentialsDeleted !== 0
    || receipt.credentialsReencrypted !== 0
    || receipt?.redacted !== true) {
    throw new Error("Unexpected Provider-owned credential migration receipt");
  }
  return record({
    databaseUrl,
    migrationKey: PROVIDER_OWNED_CREDENTIALS_KEY,
    runnerContract: PROVIDER_OWNED_CREDENTIALS_CONTRACT,
    runId: randomUUID(),
    status: "committed",
    runnerMode: "apply",
    sourceFingerprint: receipt.sourceFingerprintSha256,
    sourceTableCount: receipt.sourceTableCount,
    sourceRowCount: receipt.sourceRowCount,
    verifiedSourcePkCount: receipt.sourceRowCount,
    exactMatchedRowCount: receipt.sourceRowCount,
    postCutoverChangedRowCount: receipt.changedRows,
    summary: {
      providerRows: receipt.providerRows,
      credentialRows: receipt.credentialRows,
      defaultRows: receipt.defaultRows,
      attemptRows: receipt.attemptRows,
      revocationJobRows: receipt.revocationJobRows,
      providersDirectBound: receipt.providersDirectBound,
      providersWithoutCredential: receipt.providersWithoutCredential,
      credentialsReowned: receipt.credentialsReowned,
      defaultsCleared: receipt.defaultsCleared,
      liveCredentialRows: receipt.liveCredentialRows,
      disconnectedCredentialRows: receipt.disconnectedCredentialRows,
      credentialsCloned: 0,
      credentialsDeleted: 0,
      credentialsReencrypted: 0,
      redacted: true,
    },
  });
}

export async function recordProviderDeletedCredentialOrphansReceipt(
  databaseUrl,
  receipt,
) {
  const countFields = [
    "sourceRowCount",
    "providerRows",
    "credentialRows",
    "attemptRows",
    "changedRows",
    "providerRowsChanged",
    "credentialRowsChanged",
    "attemptRowsChanged",
    "providerPointersCleared",
    "credentialsDisconnected",
    "credentialSecretsErased",
    "attemptsCancelled",
  ];
  if (receipt?.contract !== PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT
    || receipt?.mode !== "applied"
    || receipt?.sourceTableCount !== 3
    || !/^[0-9a-f]{64}$/.test(String(receipt?.sourceFingerprintSha256 ?? ""))
    || countFields.some((field) => (
      !Number.isSafeInteger(receipt?.[field]) || receipt[field] < 0
    ))
    || receipt.sourceRowCount !== receipt.providerRows
      + receipt.credentialRows + receipt.attemptRows
    || receipt.changedRows !== receipt.providerRowsChanged
      + receipt.credentialRowsChanged + receipt.attemptRowsChanged
    || receipt.providerPointersCleared !== receipt.providerRowsChanged
    || receipt.credentialsDisconnected !== receipt.credentialRowsChanged
    || receipt.credentialSecretsErased > receipt.credentialsDisconnected
    || receipt.attemptsCancelled !== receipt.attemptRowsChanged
    || receipt.remainingDeletedProviderPointers !== 0
    || receipt.remainingDeletedProviderLiveCredentials !== 0
    || receipt.remainingDeletedProviderActiveAttempts !== 0
    || receipt.remoteRevocation !== "not_attempted"
    || receipt.revocationJobsCreated !== 0
    || receipt.remoteRevocationsSucceeded !== 0
    || receipt.credentialsDeleted !== 0
    || receipt?.redacted !== true) {
    throw new Error("Unexpected deleted-Provider credential orphan migration receipt");
  }
  return record({
    databaseUrl,
    migrationKey: PROVIDER_DELETED_CREDENTIAL_ORPHANS_KEY,
    runnerContract: PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT,
    runId: randomUUID(),
    status: "committed",
    runnerMode: "apply",
    sourceFingerprint: receipt.sourceFingerprintSha256,
    sourceTableCount: receipt.sourceTableCount,
    sourceRowCount: receipt.sourceRowCount,
    verifiedSourcePkCount: receipt.sourceRowCount,
    exactMatchedRowCount: receipt.sourceRowCount,
    postCutoverChangedRowCount: receipt.changedRows,
    summary: {
      providerRows: receipt.providerRows,
      credentialRows: receipt.credentialRows,
      attemptRows: receipt.attemptRows,
      providerPointersCleared: receipt.providerPointersCleared,
      credentialsDisconnected: receipt.credentialsDisconnected,
      credentialSecretsErased: receipt.credentialSecretsErased,
      attemptsCancelled: receipt.attemptsCancelled,
      remoteRevocation: "not_attempted",
      revocationJobsCreated: 0,
      remoteRevocationsSucceeded: 0,
      credentialsDeleted: 0,
      redacted: true,
    },
  });
}
