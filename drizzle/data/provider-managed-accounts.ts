#!/usr/bin/env -S pnpm exec tsx

// [Input] CLI arguments plus MIGRATION_DATABASE_URL and Provider credential deployment secrets.
// [Output] Dry-run or applied Provider managed-account cutover receipt from the shared migration core.
// [Pos] Source-tree compatibility entrypoint for the Provider managed-account data migration.
// [Sync] 2026-09-04: keep the journal runner path stable while delegating all behavior to the shared core.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  reportProviderManagedAccountsCliFailure,
  runProviderManagedAccountsCli,
} from "./provider-managed-accounts-core";

export * from "./provider-managed-accounts-core";

if (process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProviderManagedAccountsCli().catch(reportProviderManagedAccountsCliFailure);
}
