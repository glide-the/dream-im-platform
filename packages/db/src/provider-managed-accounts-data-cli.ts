#!/usr/bin/env node

// [Input] CLI arguments plus MIGRATION_DATABASE_URL and Provider credential deployment secrets.
// [Output] Configuration preflight or dry-run/applied Provider managed-account cutover receipt from the shared migration core.
// [Pos] Bundling entrypoint for the deployable @ink-memory/db data migration CLI.
// [Sync] 2026-09-04: allow a database-free secret preflight before acquiring an embedded migration target.
import {
  reportProviderManagedAccountsCliFailure,
  runProviderManagedAccountsCli,
} from "../../../drizzle/data/provider-managed-accounts-core";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--preflight")) {
    await runProviderManagedAccountsCli(argumentsList);
    return;
  }
  const connection = await resolveMigrationConnection();
  try {
    await runProviderManagedAccountsCli(argumentsList, {
      databaseUrl: connection.connectionString,
    });
  } finally {
    await connection.stop();
  }
}

main().catch(() => {
  reportProviderManagedAccountsCliFailure();
  // embedded-postgres registers a beforeExit hook that exits with zero; cleanup
  // has completed here, so terminate explicitly with the migration failure code.
  process.exit(1);
});
