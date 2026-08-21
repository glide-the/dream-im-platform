// [Input] Canonical capability schema from @ink-memory/db.
// [Output] Backward-compatible capability exports for application consumers.
// [Pos] Compatibility facade for the former app-local capability schema path.
// [Sync] 2026-08-21: redirect schema ownership to packages/db.
export * from "../../../../packages/db/src/schema/capabilities";
