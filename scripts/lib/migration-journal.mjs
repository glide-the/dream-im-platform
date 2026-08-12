import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const TAG_PATTERN = /^(\d{4})_[a-z0-9_]+$/;

function migrationError(code, detail) {
  const error = new Error(`${code}: ${detail}`);
  error.code = code;
  return error;
}

export function validateMigrationJournal(journal) {
  if (!journal || journal.dialect !== "postgresql" || !Array.isArray(journal.entries)) {
    throw migrationError("MIGRATION_JOURNAL_INVALID", "expected a PostgreSQL entries array");
  }

  const tags = new Set();
  const timestamps = new Set();
  return journal.entries.map((entry, position) => {
    const match = typeof entry?.tag === "string" ? entry.tag.match(TAG_PATTERN) : null;
    if (
      !entry
      || entry.idx !== position
      || !match
      || Number(match[1]) !== position
      || !Number.isSafeInteger(entry.when)
      || entry.when <= 0
      || typeof entry.version !== "string"
    ) {
      throw migrationError(
        "MIGRATION_JOURNAL_INVALID",
        `entry ${position} must have a contiguous idx, matching tag prefix, version and timestamp`,
      );
    }
    if (tags.has(entry.tag) || timestamps.has(String(entry.when))) {
      throw migrationError(
        "MIGRATION_JOURNAL_INVALID",
        `entry ${position} reuses a tag or timestamp`,
      );
    }
    tags.add(entry.tag);
    timestamps.add(String(entry.when));
    return {
      idx: position,
      tag: entry.tag,
      createdAt: entry.when,
    };
  });
}

export async function readMigrationPlan(migrationsDirectory, throughTag) {
  const journal = JSON.parse(
    await readFile(`${migrationsDirectory}/meta/_journal.json`, "utf8"),
  );
  const entries = validateMigrationJournal(journal);
  const migrations = await Promise.all(entries.map(async (entry) => {
    const sql = await readFile(`${migrationsDirectory}/${entry.tag}.sql`, "utf8");
    return {
      ...entry,
      hash: createHash("sha256").update(sql).digest("hex"),
      statements: sql
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean),
    };
  }));

  let targetCount = migrations.length;
  if (throughTag !== undefined) {
    const boundary = migrations.findIndex((migration) => migration.tag === throughTag);
    if (boundary < 0) {
      throw migrationError(
        "MIGRATION_BOUNDARY_UNKNOWN",
        `journal does not contain ${throughTag}`,
      );
    }
    targetCount = boundary + 1;
  }
  return { migrations, targetCount };
}

export function validateAppliedPrefix(migrations, appliedRows) {
  const byTimestamp = new Map(
    migrations.map((migration) => [String(migration.createdAt), migration]),
  );
  const appliedIndexes = new Set();

  for (const row of appliedRows) {
    const migration = byTimestamp.get(String(row.created_at));
    if (!migration) {
      throw migrationError(
        "MIGRATION_DATABASE_UNKNOWN_ENTRY",
        `database contains unknown migration timestamp ${String(row.created_at)}`,
      );
    }
    if (String(row.hash) !== migration.hash) {
      throw migrationError(
        "MIGRATION_DATABASE_HASH_MISMATCH",
        `applied migration ${migration.tag} no longer matches its journal SQL`,
      );
    }
    if (appliedIndexes.has(migration.idx)) {
      throw migrationError(
        "MIGRATION_DATABASE_DUPLICATE_ENTRY",
        `database contains duplicate receipt for ${migration.tag}`,
      );
    }
    appliedIndexes.add(migration.idx);
  }

  const appliedCount = appliedIndexes.size;
  for (let idx = 0; idx < appliedCount; idx += 1) {
    if (!appliedIndexes.has(idx)) {
      throw migrationError(
        "MIGRATION_DATABASE_GAP",
        `database receipts are not a contiguous journal prefix at index ${idx}`,
      );
    }
  }
  if ([...appliedIndexes].some((idx) => idx >= appliedCount)) {
    throw migrationError(
      "MIGRATION_DATABASE_GAP",
      "database receipts skip an earlier journal entry",
    );
  }
  return appliedCount;
}

export function migrationStatus(plan, appliedRows) {
  const appliedCount = validateAppliedPrefix(plan.migrations, appliedRows);
  if (appliedCount > plan.targetCount) {
    throw migrationError(
      "MIGRATION_BOUNDARY_BEHIND_DATABASE",
      "requested boundary is older than the database prefix",
    );
  }
  return {
    appliedCount,
    targetCount: plan.targetCount,
    availableCount: plan.migrations.length,
    pending: plan.migrations.slice(appliedCount, plan.targetCount),
    latestApplied: appliedCount ? plan.migrations[appliedCount - 1].tag : null,
    latestTarget: plan.targetCount ? plan.migrations[plan.targetCount - 1].tag : null,
    latestAvailable: plan.migrations.at(-1)?.tag ?? null,
  };
}
