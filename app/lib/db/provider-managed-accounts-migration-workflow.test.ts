// [Input] Schema migrator, Provider account release orchestrator, and root package commands.
// [Output] Source-contract proof that all three Provider expand/data/contract stages are explicit, resumable, and truthfully logged.
// [Pos] Focused regression test for the Provider credential migration workflow reported by operators.
// [Sync] 2026-09-04: require orphan repair to share the same target lifecycle before its 0052 contract.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();
const migrator = readFileSync(resolve(root, "packages/db/src/migrate.ts"), "utf8");
const orchestrator = readFileSync(
  resolve(root, "scripts/migrate-provider-managed-accounts.mjs"),
  "utf8",
);
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
};

describe("Provider managed-account migration workflow", () => {
  it("does not report a migration as applied until the transaction commits", () => {
    const commit = migrator.indexOf('await client.query("COMMIT")');
    const appliedLog = migrator.indexOf("for (const tag of appliedTags)");

    expect(commit).toBeGreaterThan(-1);
    expect(appliedLog).toBeGreaterThan(commit);
    expect(migrator).not.toContain("console.log(`Applied migration ${migration.tag}`)");
    expect(migrator).toContain("No migration from this invocation was committed");
    expect(migrator).toContain("PROVIDER_MANAGED_ACCOUNTS_CONTRACT_BLOCKED:");
    expect(migrator).toContain("PROVIDER_OWNED_CREDENTIALS_CONTRACT_BLOCKED:");
    expect(migrator).toContain("PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT_BLOCKED:");
    expect(migrator).toContain("Run the Provider migration orchestrator");
  });

  it("orders every expand/data/contract stage and final check through compiled DB CLIs", () => {
    const managedPreflight = orchestrator.indexOf(
      'execute(managedAccountsDataCli, ["--preflight"], process.env)',
    );
    const ownedPreflight = orchestrator.indexOf(
      'execute(providerOwnedDataCli, ["--preflight"], process.env)',
    );
    const orphanPreflight = orchestrator.indexOf(
      'execute(deletedProviderOrphanDataCli, ["--preflight"], process.env)',
    );
    const connection = orchestrator.indexOf("const connection = await resolveMigrationConnection()");
    const poolExpand = orchestrator.indexOf(
      'execute(migrationCli, ["--through", expandTag], migrationEnvironment)',
    );
    const poolDryRun = orchestrator.indexOf(
      "execute(managedAccountsDataCli, [], migrationEnvironment)",
    );
    const poolApply = orchestrator.indexOf(
      'execute(managedAccountsDataCli, ["--apply"], migrationEnvironment)',
    );
    const ownerExpand = orchestrator.indexOf(
      'execute(migrationCli, ["--through", ownershipExpandTag], migrationEnvironment)',
    );
    const ownerDryRun = orchestrator.indexOf(
      "execute(providerOwnedDataCli, [], migrationEnvironment)",
    );
    const ownerApply = orchestrator.indexOf(
      'execute(providerOwnedDataCli, ["--apply"], migrationEnvironment)',
    );
    const orphanExpand = orchestrator.indexOf(
      '["--through", deletedProviderOrphanExpandTag]',
    );
    const orphanDryRun = orchestrator.indexOf(
      "execute(deletedProviderOrphanDataCli, [], migrationEnvironment)",
    );
    const orphanApply = orchestrator.indexOf(
      'execute(deletedProviderOrphanDataCli, ["--apply"], migrationEnvironment)',
    );
    const contract = orchestrator.indexOf(
      'console.log("Applying the remaining generated migrations...")',
    );
    const check = orchestrator.indexOf(
      'execute(migrationCli, ["--check"], migrationEnvironment)',
    );

    expect(orchestrator).toContain('"packages/db/dist/provider-managed-accounts-data.js"');
    expect(orchestrator).toContain('"packages/db/dist/provider-owned-credentials-data.js"');
    expect(orchestrator).toContain('"packages/db/dist/provider-deleted-credential-orphans-data.js"');
    expect(managedPreflight).toBeGreaterThan(-1);
    expect(ownedPreflight).toBeGreaterThan(managedPreflight);
    expect(orphanPreflight).toBeGreaterThan(ownedPreflight);
    expect(connection).toBeGreaterThan(orphanPreflight);
    expect(poolExpand).toBeGreaterThan(-1);
    expect(poolDryRun).toBeGreaterThan(poolExpand);
    expect(poolApply).toBeGreaterThan(poolDryRun);
    expect(ownerExpand).toBeGreaterThan(poolApply);
    expect(ownerDryRun).toBeGreaterThan(ownerExpand);
    expect(ownerApply).toBeGreaterThan(ownerDryRun);
    expect(orphanExpand).toBeGreaterThan(ownerApply);
    expect(orphanDryRun).toBeGreaterThan(orphanExpand);
    expect(orphanApply).toBeGreaterThan(orphanDryRun);
    expect(contract).toBeGreaterThan(orphanApply);
    expect(check).toBeGreaterThan(contract);
    expect(packageJson.scripts["db:migrate:provider-managed-accounts"]).toContain(
      "pnpm --filter @ink-memory/db build",
    );
    expect(packageJson.scripts["db:migrate"]).toContain(
      "node scripts/migrate-provider-managed-accounts.mjs",
    );
    expect(orchestrator).toContain("const connection = await resolveMigrationConnection()");
    expect(orchestrator).toContain("MIGRATION_DATABASE_URL: connection.connectionString");
    expect(orchestrator).toContain("await connection.stop()");
  });
});
