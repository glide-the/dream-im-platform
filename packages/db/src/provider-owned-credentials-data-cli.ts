#!/usr/bin/env node

// [Input] CLI arguments plus the shared migration target and Provider credential encryption key.
// [Output] Configuration preflight or Provider-owned credential cutover receipt.
// [Pos] Bundling entrypoint for the deployable @ink-memory/db ownership data migration CLI.
// [Sync] 2026-09-04: share the schema migration target lifecycle with provider-owned-credentials-v1.
import {
  reportProviderOwnedCredentialsCliFailure,
  runProviderOwnedCredentialsCli,
} from "../../../drizzle/data/provider-owned-credentials-core";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--preflight")) {
    await runProviderOwnedCredentialsCli(argumentsList);
    return;
  }
  const connection = await resolveMigrationConnection();
  try {
    await runProviderOwnedCredentialsCli(argumentsList, {
      databaseUrl: connection.connectionString,
    });
  } finally {
    await connection.stop();
  }
}

main().catch((error) => {
  reportProviderOwnedCredentialsCliFailure(error);
  process.exit(1);
});
