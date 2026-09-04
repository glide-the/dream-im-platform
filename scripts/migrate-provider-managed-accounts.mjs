#!/usr/bin/env node

// [Input] Compiled @ink-memory/db migration/data CLIs and one explicit or embedded migration target.
// [Output] Ordered Provider ownership cutovers followed by 0051/data/0052 deleted-Provider orphan invalidation and final proof.
// [Pos] Release orchestration for immutable Provider credential data gates; application startup never invokes it.
// [Sync] 2026-09-04: add secret-safe local orphan invalidation without claiming remote revocation.

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const adminRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const migrationCli = resolve(adminRoot, "packages/db/dist/migrate.js");
const managedAccountsDataCli = resolve(adminRoot, "packages/db/dist/provider-managed-accounts-data.js");
const providerOwnedDataCli = resolve(adminRoot, "packages/db/dist/provider-owned-credentials-data.js");
const deletedProviderOrphanDataCli = resolve(
  adminRoot,
  "packages/db/dist/provider-deleted-credential-orphans-data.js",
);
const migrationRuntime = resolve(adminRoot, "packages/db/dist/migration-runtime.js");
const expandTag = "0047_provider_managed_accounts_expand";
const contractTag = "0048_provider_managed_accounts_contract";
const ownershipExpandTag = "0049_provider_owned_credentials_expand";
const ownershipContractTag = "0050_provider_owned_credentials_contract";
const deletedProviderOrphanExpandTag = "0051_provider_deleted_credential_orphans_expand";
const deletedProviderOrphanContractTag = "0052_provider_deleted_credential_orphans_contract";

function execute(script, args, env, stdio = "inherit") {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: adminRoot,
      env,
      stdio,
    });
    let stdout = "";
    let stderr = "";
    if (child.stdout) child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    if (child.stderr) child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolvePromise({ stdout, stderr });
      else reject(Object.assign(
        new Error(`Migration phase exited with ${code ?? signal}`),
        { code, signal, stdout, stderr },
      ));
    });
  });
}

function statusReceipt(output) {
  for (const line of output.split(/\r?\n/).reverse()) {
    const candidate = line.trim();
    if (!candidate.startsWith("{") || !candidate.endsWith("}")) continue;
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed?.pendingTags)) return parsed;
    } catch {
      // Non-JSON runtime logs are not migration status receipts.
    }
  }
  throw new Error("Migration status command did not emit a machine-readable receipt");
}

async function main() {
  if (process.argv.length !== 2) {
    throw new Error("Usage: pnpm db:migrate (or pnpm db:migrate:provider-managed-accounts)");
  }

  try {
    await execute(managedAccountsDataCli, ["--preflight"], process.env);
    await execute(providerOwnedDataCli, ["--preflight"], process.env);
    await execute(deletedProviderOrphanDataCli, ["--preflight"], process.env);
  } catch (error) {
    throw Object.assign(
      new Error("Provider credential migration configuration is incomplete; run `pnpm env:setup` and retry `pnpm db:migrate`."),
      { stdout: error?.stdout, stderr: error?.stderr },
    );
  }

  const { resolveMigrationConnection } = await import(pathToFileURL(migrationRuntime).href);
  const connection = await resolveMigrationConnection();
  const migrationEnvironment = {
    ...process.env,
    MIGRATION_DATABASE_URL: connection.connectionString,
  };
  try {
    const statusOutput = await execute(migrationCli, ["--status"], migrationEnvironment, "pipe");
    const status = statusReceipt(statusOutput.stdout);

    if (status.pendingTags.includes(contractTag)) {
      console.log(`Preparing ${expandTag} on the migration target...`);
      await execute(migrationCli, ["--through", expandTag], migrationEnvironment);
      console.log("Checking Provider managed-account data migration without writes...");
      await execute(managedAccountsDataCli, [], migrationEnvironment);
      console.log("Applying the audited Provider managed-account data migration...");
      await execute(managedAccountsDataCli, ["--apply"], migrationEnvironment);
    }

    if (status.pendingTags.includes(ownershipContractTag)) {
      console.log(`Preparing ${ownershipExpandTag} on the migration target...`);
      await execute(migrationCli, ["--through", ownershipExpandTag], migrationEnvironment);
      console.log("Checking Provider direct-ownership data migration without writes...");
      await execute(providerOwnedDataCli, [], migrationEnvironment);
      console.log("Applying the audited Provider direct-ownership data migration...");
      await execute(providerOwnedDataCli, ["--apply"], migrationEnvironment);
    }

    if (status.pendingTags.includes(deletedProviderOrphanContractTag)) {
      console.log(`Preparing ${deletedProviderOrphanExpandTag} on the migration target...`);
      await execute(
        migrationCli,
        ["--through", deletedProviderOrphanExpandTag],
        migrationEnvironment,
      );
      console.log("Checking deleted-Provider credential orphans without writes...");
      await execute(deletedProviderOrphanDataCli, [], migrationEnvironment);
      console.log("Applying audited local invalidation for deleted-Provider credential orphans...");
      await execute(deletedProviderOrphanDataCli, ["--apply"], migrationEnvironment);
    }

    console.log("Applying the remaining generated migrations...");
    await execute(migrationCli, [], migrationEnvironment);
    await execute(migrationCli, ["--check"], migrationEnvironment);
    console.log("Provider credential migration workflow completed successfully.");
  } finally {
    await connection.stop();
  }
}

main().catch((error) => {
  if (error?.stdout) process.stdout.write(error.stdout);
  if (error?.stderr) process.stderr.write(error.stderr);
  console.error(error instanceof Error ? error.message : "Provider credential migration workflow failed");
  process.exitCode = 1;
});
