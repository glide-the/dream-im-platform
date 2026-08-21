// [Input] @ink-memory/db application client.
// [Output] Stable legacy imports for the shared PostgreSQL pool.
// [Pos] Next.js compatibility facade; pool ownership lives in packages/db.
// [Sync] 2026-08-21: redirect database client ownership to the workspace package.
export {
  closePoolForTests,
  getPool,
  validatedDatabaseUrl,
} from "@ink-memory/db/client";
