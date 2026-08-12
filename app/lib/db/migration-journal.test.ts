import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  migrationStatus,
  validateAppliedPrefix,
  validateMigrationJournal,
} from "../../../scripts/lib/migration-journal.mjs";

const sqlHash = (value: string) => createHash("sha256").update(value).digest("hex");
const migrations = [
  { idx: 0, tag: "0000_first", createdAt: 30, hash: sqlHash("first") },
  { idx: 1, tag: "0001_second", createdAt: 10, hash: sqlHash("second") },
  { idx: 2, tag: "0002_third", createdAt: 20, hash: sqlHash("third") },
];

describe("migration journal contract", () => {
  it("accepts unique non-monotonic timestamps while enforcing contiguous idx/tag", () => {
    expect(validateMigrationJournal({
      dialect: "postgresql",
      entries: migrations.map((migration) => ({
        idx: migration.idx,
        tag: migration.tag,
        when: migration.createdAt,
        version: "7",
      })),
    })).toHaveLength(3);
  });

  it("rejects duplicate timestamps and mismatched tag prefixes", () => {
    expect(() => validateMigrationJournal({
      dialect: "postgresql",
      entries: [
        { idx: 0, tag: "0000_first", when: 1, version: "7" },
        { idx: 1, tag: "0002_wrong", when: 1, version: "7" },
      ],
    })).toThrow(/MIGRATION_JOURNAL_INVALID/);
  });

  it("accepts only an exact applied prefix regardless of timestamp ordering", () => {
    const applied = [
      { created_at: 10, hash: migrations[1].hash },
      { created_at: 30, hash: migrations[0].hash },
    ];
    expect(validateAppliedPrefix(migrations, applied)).toBe(2);
    expect(migrationStatus({ migrations, targetCount: 3 }, applied)).toMatchObject({
      appliedCount: 2,
      latestApplied: "0001_second",
      pending: [migrations[2]],
    });
  });

  it("rejects gaps, unknown receipts, duplicate receipts and rewritten SQL", () => {
    expect(() => validateAppliedPrefix(migrations, [
      { created_at: 30, hash: migrations[0].hash },
      { created_at: 20, hash: migrations[2].hash },
    ])).toThrow(/MIGRATION_DATABASE_GAP/);
    expect(() => validateAppliedPrefix(migrations, [
      { created_at: 99, hash: "unknown" },
    ])).toThrow(/MIGRATION_DATABASE_UNKNOWN_ENTRY/);
    expect(() => validateAppliedPrefix(migrations, [
      { created_at: 30, hash: migrations[0].hash },
      { created_at: 30, hash: migrations[0].hash },
    ])).toThrow(/MIGRATION_DATABASE_DUPLICATE_ENTRY/);
    expect(() => validateAppliedPrefix(migrations, [
      { created_at: 30, hash: "rewritten" },
    ])).toThrow(/MIGRATION_DATABASE_HASH_MISMATCH/);
  });
});
