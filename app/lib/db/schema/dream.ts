// [Input] Canonical Dream schema from @ink-memory/db.
// [Output] Backward-compatible exports for application code and contract tests.
// [Pos] Compatibility facade for the former app-local Dream schema path.
// [Sync] 2026-08-21: redirect schema ownership to packages/db.
export * from "../../../../packages/db/src/schema/dream";
