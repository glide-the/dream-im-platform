#!/usr/bin/env -S pnpm exec tsx

// [Input] CLI arguments plus MIGRATION_DATABASE_URL and the Provider credential encryption key.
// [Output] Dry-run or applied Provider-owned credential cutover receipt from the shared migration core.
// [Pos] Source-tree journal entrypoint for provider-owned-credentials-v1.
// [Sync] 2026-09-04: keep the audited runner path stable while delegating behavior to the shared core.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  reportProviderOwnedCredentialsCliFailure,
  runProviderOwnedCredentialsCli,
} from "./provider-owned-credentials-core";

export * from "./provider-owned-credentials-core";

if (process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProviderOwnedCredentialsCli().catch(reportProviderOwnedCredentialsCliFailure);
}
