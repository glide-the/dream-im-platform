#!/usr/bin/env node

// [Input] CLI arguments plus the shared explicit or embedded migration target.
// [Output] Configuration preflight or deleted-Provider credential orphan repair receipt.
// [Pos] Deployable @ink-memory/db CLI for the 0051/data/0052 repair stage.
// [Sync] 2026-09-04: reuse one migration target lifecycle without attempting remote revocation.
import {
  reportDeletedProviderCredentialOrphanCliFailure,
  runDeletedProviderCredentialOrphanCli,
} from "../../../drizzle/data/provider-deleted-credential-orphans-core";
import { resolveMigrationConnection } from "./migration-runtime.js";

async function main() {
  const argumentsList = process.argv.slice(2);
  if (argumentsList.includes("--preflight")) {
    await runDeletedProviderCredentialOrphanCli(argumentsList);
    return;
  }
  const connection = await resolveMigrationConnection();
  try {
    await runDeletedProviderCredentialOrphanCli(argumentsList, {
      databaseUrl: connection.connectionString,
    });
  } finally {
    await connection.stop();
  }
}

main().catch((error) => {
  reportDeletedProviderCredentialOrphanCliFailure(error);
  process.exit(1);
});
