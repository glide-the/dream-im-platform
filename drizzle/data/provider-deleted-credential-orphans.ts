#!/usr/bin/env -S pnpm exec tsx

// [Input] CLI arguments plus MIGRATION_DATABASE_URL after the 0051 repair definition is installed.
// [Output] Dry-run or applied deleted-Provider credential orphan repair receipt from the shared core.
// [Pos] Source-tree journal entrypoint for provider-deleted-credential-orphans-v1.
// [Sync] 2026-09-04: keep the audited runner path stable and make remoteRevocation=not_attempted explicit.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  reportDeletedProviderCredentialOrphanCliFailure,
  runDeletedProviderCredentialOrphanCli,
} from "./provider-deleted-credential-orphans-core";

export * from "./provider-deleted-credential-orphans-core";

if (process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runDeletedProviderCredentialOrphanCli()
    .catch(reportDeletedProviderCredentialOrphanCliFailure);
}
