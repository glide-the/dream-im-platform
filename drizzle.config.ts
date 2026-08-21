// [Input] Canonical Drizzle config owned by @ink-memory/db.
// [Output] Backward-compatible root config for existing operator commands.
// [Pos] Compatibility facade; packages/db/drizzle.config.ts is authoritative.
// [Sync] 2026-08-21: move schema-generation configuration into packages/db.
export { default } from "./packages/db/drizzle.config";
