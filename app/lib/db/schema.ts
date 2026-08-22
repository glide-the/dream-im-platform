// [Input] Canonical @ink-memory/db schema package.
// [Output] Backward-compatible application imports for the shared PostgreSQL schema.
// [Pos] Compatibility facade; new schema ownership lives in packages/db/src/schema/.
// [Sync] 2026-08-21: redirect the legacy application path to the database workspace package.
export * from "../../../packages/db/src/schema/index";
