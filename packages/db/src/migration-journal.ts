// [Input] Immutable root drizzle journal, SQL files, and applied ledger rows.
// [Output] Hash-verified contiguous migration plans and status receipts.
// [Pos] Migration integrity boundary owned by @ink-memory/db.
// [Sync] 2026-08-21: move migration planning into the Paperclip-style DB package.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const TAG_PATTERN = /^(\d{4})_[a-z0-9_]+$/;

type JournalEntry = { idx: number; tag: string; when: number; version: string };
export type Migration = { idx: number; tag: string; createdAt: number; hash: string; statements: string[] };
export type MigrationPlan = { migrations: Migration[]; targetCount: number };
export type AppliedMigration = { hash: string; created_at: string | number };

function migrationError(code: string, detail: string): Error & { code: string } {
  return Object.assign(new Error(`${code}: ${detail}`), { code });
}

export function validateMigrationJournal(journal: unknown): Array<{ idx: number; tag: string; createdAt: number }> {
  const value = journal as { dialect?: unknown; entries?: unknown[] };
  if (!value || value.dialect !== "postgresql" || !Array.isArray(value.entries)) {
    throw migrationError("MIGRATION_JOURNAL_INVALID", "expected a PostgreSQL entries array");
  }
  const tags = new Set<string>();
  const timestamps = new Set<string>();
  return value.entries.map((raw, position) => {
    const entry = raw as JournalEntry;
    const match = typeof entry?.tag === "string" ? entry.tag.match(TAG_PATTERN) : null;
    if (!entry || entry.idx !== position || !match || Number(match[1]) !== position ||
        !Number.isSafeInteger(entry.when) || entry.when <= 0 || typeof entry.version !== "string") {
      throw migrationError("MIGRATION_JOURNAL_INVALID", `entry ${position} must have a contiguous idx, matching tag prefix, version and timestamp`);
    }
    if (tags.has(entry.tag) || timestamps.has(String(entry.when))) {
      throw migrationError("MIGRATION_JOURNAL_INVALID", `entry ${position} reuses a tag or timestamp`);
    }
    tags.add(entry.tag);
    timestamps.add(String(entry.when));
    return { idx: position, tag: entry.tag, createdAt: entry.when };
  });
}

export async function readMigrationPlan(directory: string, throughTag?: string): Promise<MigrationPlan> {
  const journal = JSON.parse(await readFile(`${directory}/meta/_journal.json`, "utf8"));
  const entries = validateMigrationJournal(journal);
  const migrations = await Promise.all(entries.map(async (entry) => {
    const sql = await readFile(`${directory}/${entry.tag}.sql`, "utf8");
    return {
      ...entry,
      hash: createHash("sha256").update(sql).digest("hex"),
      statements: sql.split("--> statement-breakpoint").map((item) => item.trim()).filter(Boolean),
    };
  }));
  let targetCount = migrations.length;
  if (throughTag !== undefined) {
    const boundary = migrations.findIndex((migration) => migration.tag === throughTag);
    if (boundary < 0) throw migrationError("MIGRATION_BOUNDARY_UNKNOWN", `journal does not contain ${throughTag}`);
    targetCount = boundary + 1;
  }
  return { migrations, targetCount };
}

export function validateAppliedPrefix(migrations: Migration[], appliedRows: AppliedMigration[]): number {
  const byTimestamp = new Map(migrations.map((migration) => [String(migration.createdAt), migration]));
  const appliedIndexes = new Set<number>();
  for (const row of appliedRows) {
    const migration = byTimestamp.get(String(row.created_at));
    if (!migration) throw migrationError("MIGRATION_DATABASE_UNKNOWN_ENTRY", `database contains unknown migration timestamp ${String(row.created_at)}`);
    if (String(row.hash) !== migration.hash) throw migrationError("MIGRATION_DATABASE_HASH_MISMATCH", `applied migration ${migration.tag} no longer matches its journal SQL`);
    if (appliedIndexes.has(migration.idx)) throw migrationError("MIGRATION_DATABASE_DUPLICATE_ENTRY", `database contains duplicate receipt for ${migration.tag}`);
    appliedIndexes.add(migration.idx);
  }
  const count = appliedIndexes.size;
  for (let index = 0; index < count; index += 1) {
    if (!appliedIndexes.has(index)) throw migrationError("MIGRATION_DATABASE_GAP", `database receipts are not a contiguous journal prefix at index ${index}`);
  }
  if ([...appliedIndexes].some((index) => index >= count)) {
    throw migrationError("MIGRATION_DATABASE_GAP", "database receipts skip an earlier journal entry");
  }
  return count;
}

export function migrationStatus(plan: MigrationPlan, rows: AppliedMigration[]) {
  const appliedCount = validateAppliedPrefix(plan.migrations, rows);
  if (appliedCount > plan.targetCount) throw migrationError("MIGRATION_BOUNDARY_BEHIND_DATABASE", "requested boundary is older than the database prefix");
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
