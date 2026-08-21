// [Input] Canonical migration journal implementation from @ink-memory/db.
// [Output] Backward-compatible exports for legacy contract tests.
// [Pos] Compatibility facade; packages/db/src/migration-journal.ts is authoritative.
// [Sync] 2026-08-21: redirect migration journal ownership to packages/db.
export {
  migrationStatus,
  readMigrationPlan,
  validateAppliedPrefix,
  validateMigrationJournal,
} from "../../packages/db/src/migration-journal.ts";
