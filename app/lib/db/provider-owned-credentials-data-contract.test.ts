// [Input] Pool-era Provider/default rows plus 0049/data/0050 source, snapshots, journals, registry, and package CLI contracts.
// [Output] Provider-free proof of fail-closed effective-binding planning and forward-only direct ownership DDL.
// [Pos] Focused regression contract for provider-owned-credentials-v1.
// [Sync] 2026-09-04: exclude deleted Providers from effective-owner competition while preserving fail-closed live-orphan handling.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  planProviderOwnedCredentialCutover,
  type ProviderOwnedAttemptRow,
  type ProviderOwnedCredentialRow,
  type ProviderOwnedDefaultRow,
  type ProviderOwnedProviderRow,
  type ProviderOwnedRevocationRow,
} from "../../../drizzle/data/provider-owned-credentials";

const root = process.cwd();
const expand = readFileSync(
  resolve(root, "drizzle/0049_provider_owned_credentials_expand.sql"),
  "utf8",
);
const contract = readFileSync(
  resolve(root, "drizzle/0050_provider_owned_credentials_contract.sql"),
  "utf8",
);
const migrationCore = readFileSync(
  resolve(root, "drizzle/data/provider-owned-credentials-core.ts"),
  "utf8",
);
const sourceCli = readFileSync(
  resolve(root, "drizzle/data/provider-owned-credentials.ts"),
  "utf8",
);
const packageCli = readFileSync(
  resolve(root, "packages/db/src/provider-owned-credentials-data-cli.ts"),
  "utf8",
);
const registry = readFileSync(resolve(root, "drizzle/data/registry.mjs"), "utf8");
const schema = readFileSync(resolve(root, "packages/db/src/schema/index.ts"), "utf8");
const schemaJournal = JSON.parse(readFileSync(
  resolve(root, "drizzle/meta/_journal.json"),
  "utf8",
)) as { entries: Array<{ idx: number; tag: string }> };
const dataJournal = JSON.parse(readFileSync(
  resolve(root, "drizzle/data/_journal.json"),
  "utf8",
)) as { entries: Array<{ idx: number; migrationKey: string; runner: string }> };
const contractSnapshot = JSON.parse(readFileSync(
  resolve(root, "drizzle/meta/0050_snapshot.json"),
  "utf8",
)) as { tables: Record<string, unknown> };
const databasePackage = JSON.parse(readFileSync(
  resolve(root, "packages/db/package.json"),
  "utf8",
)) as { exports: Record<string, string>; scripts: Record<string, string> };

const identityHash = `hmac-sha256:${"a".repeat(64)}`;

function credential(
  id: string,
  providerId: string | null,
  status: ProviderOwnedCredentialRow["status"] = "connected",
): ProviderOwnedCredentialRow {
  return {
    id,
    provider_id: providerId,
    adapter_kind: "codex",
    status,
    auth_epoch: 1,
    revision: 1,
    envelope_context_id: id,
    bundle_format_version: null,
    bundle_key_id: null,
    bundle_ciphertext: null,
    bundle_nonce: null,
    bundle_tag: null,
    account_identity_hash: status === "connected" ? identityHash : null,
  };
}

function provider(
  id: string,
  mode: ProviderOwnedProviderRow["managed_account_binding_mode"],
  credentialId: string | null,
  status: ProviderOwnedProviderRow["status"] = "active",
): ProviderOwnedProviderRow {
  return {
    id,
    adapter_kind: "codex",
    status,
    managed_account_binding_mode: mode,
    managed_credential_id: credentialId,
  };
}

const noAttempts: ProviderOwnedAttemptRow[] = [];
const noRevocations: ProviderOwnedRevocationRow[] = [];

describe("Provider-owned credential cutover planner", () => {
  it("uses effective pinned/default bindings rather than provenance provider_id", () => {
    const providers = [
      provider("provider-a", "pinned", "credential-a"),
      provider("provider-b", "follow_default", null),
    ];
    const credentials = [
      credential("credential-a", "provider-b"),
      credential("credential-b", "provider-a"),
    ];
    const defaults: ProviderOwnedDefaultRow[] = [{
      adapter_kind: "codex",
      credential_id: "credential-b",
      revision: 3,
    }];

    expect(planProviderOwnedCredentialCutover({
      providers,
      credentials,
      defaults,
      attempts: noAttempts,
      revocationJobs: noRevocations,
      validateEnvelopes: false,
    })).toMatchObject({
      providerRowsChanged: 1,
      credentialRowsChanged: 2,
      providersDirectBound: 2,
      liveCredentialRows: 2,
      sharedLiveCredentials: 0,
      orphanLiveCredentials: 0,
      providerTargets: [
        { providerId: "provider-a", credentialId: "credential-a" },
        { providerId: "provider-b", credentialId: "credential-b" },
      ],
      credentialTargets: [
        { credentialId: "credential-a", providerId: "provider-a" },
        { credentialId: "credential-b", providerId: "provider-b" },
      ],
    });
  });

  it("blocks a live credential shared by pinned and follow-default Providers", () => {
    expect(() => planProviderOwnedCredentialCutover({
      providers: [
        provider("provider-a", "pinned", "credential-a"),
        provider("provider-b", "follow_default", null),
      ],
      credentials: [credential("credential-a", "provider-a")],
      defaults: [{ adapter_kind: "codex", credential_id: "credential-a", revision: 1 }],
      attempts: noAttempts,
      revocationJobs: noRevocations,
      validateEnvelopes: false,
    })).toThrow("shared live credentials require explicit reauthorization (1)");
  });

  it.each(["active", "disabled"] as const)(
    "lets the sole %s follow-default Provider take over the default from a deleted Provider",
    (status) => {
      const providerId = `provider-${status}`;
      const plan = planProviderOwnedCredentialCutover({
        providers: [
          provider("provider-deleted", "follow_default", null, "deleted"),
          provider(providerId, "follow_default", null, status),
        ],
        credentials: [credential("credential-default", "provider-deleted")],
        defaults: [{
          adapter_kind: "codex",
          credential_id: "credential-default",
          revision: 1,
        }],
        attempts: noAttempts,
        revocationJobs: noRevocations,
        validateEnvelopes: false,
      });

      expect(plan).toMatchObject({
        providerRowsChanged: 2,
        credentialRowsChanged: 1,
        providersDirectBound: 1,
        providersWithoutCredential: 1,
        sharedLiveCredentials: 0,
        orphanLiveCredentials: 0,
        providerTargets: [
          {
            providerId: "provider-deleted",
            credentialId: null,
            changed: true,
          },
          {
            providerId,
            credentialId: "credential-default",
            changed: true,
          },
        ],
        credentialTargets: [{
          credentialId: "credential-default",
          providerId,
          changed: true,
        }],
      });
      expect(migrationCore).toContain("SET managed_account_binding_mode = 'pinned'");
    },
  );

  it("still blocks two non-deleted Providers competing for the same live default", () => {
    expect(() => planProviderOwnedCredentialCutover({
      providers: [
        provider("provider-active", "follow_default", null, "active"),
        provider("provider-disabled", "follow_default", null, "disabled"),
      ],
      credentials: [credential("credential-default", "provider-active")],
      defaults: [{
        adapter_kind: "codex",
        credential_id: "credential-default",
        revision: 1,
      }],
      attempts: noAttempts,
      revocationJobs: noRevocations,
      validateEnvelopes: false,
    })).toThrow("shared live credentials require explicit reauthorization (1)");
  });

  it("keeps a live default fail-closed as orphaned when its only candidate is deleted", () => {
    expect(() => planProviderOwnedCredentialCutover({
      providers: [
        provider("provider-deleted", "follow_default", null, "deleted"),
      ],
      credentials: [credential("credential-orphan", "provider-deleted")],
      defaults: [{
        adapter_kind: "codex",
        credential_id: "credential-orphan",
        revision: 1,
      }],
      attempts: noAttempts,
      revocationJobs: noRevocations,
      validateEnvelopes: false,
    })).toThrow("orphan live credentials require explicit disposition (1)");
  });

  it("blocks an unreferenced live credential instead of deleting it", () => {
    expect(() => planProviderOwnedCredentialCutover({
      providers: [provider("provider-a", "pinned", "credential-a")],
      credentials: [
        credential("credential-a", "provider-a"),
        credential("credential-orphan", "provider-a"),
      ],
      defaults: [],
      attempts: noAttempts,
      revocationJobs: noRevocations,
      validateEnvelopes: false,
    })).toThrow("orphan live credentials require explicit disposition (1)");
  });

  it.each([
    {
      label: "active auth attempt",
      attempts: [{
        id: "attempt-a",
        provider_id: "provider-a",
        adapter_kind: "codex" as const,
        target_credential_id: "credential-a",
        status: "pending" as const,
      }],
      revocationJobs: noRevocations,
      message: "active auth attempts remain (1)",
    },
    {
      label: "non-terminal revocation",
      attempts: noAttempts,
      revocationJobs: [{
        id: "revoke-a",
        provider_id: "provider-a",
        adapter_kind: "codex" as const,
        managed_credential_id: "credential-a",
        status: "failed" as const,
        bundle_format_version: null,
        bundle_key_id: null,
        bundle_ciphertext: null,
        bundle_nonce: null,
        bundle_tag: null,
      }],
      message: "non-terminal revocation jobs remain (1)",
    },
  ])("blocks $label before planning writes", ({ attempts, revocationJobs, message }) => {
    expect(() => planProviderOwnedCredentialCutover({
      providers: [provider("provider-a", "pinned", "credential-a")],
      credentials: [credential("credential-a", "provider-a")],
      defaults: [],
      attempts,
      revocationJobs,
      validateEnvelopes: false,
    })).toThrow(message);
  });

  it("blocks dangling pointers, adapter mismatches, and stale provenance", () => {
    expect(() => planProviderOwnedCredentialCutover({
      providers: [provider("provider-a", "pinned", "missing")],
      credentials: [],
      defaults: [],
      attempts: noAttempts,
      revocationJobs: noRevocations,
      validateEnvelopes: false,
    })).toThrow("Provider credential is dangling or adapter-mismatched");

    expect(() => planProviderOwnedCredentialCutover({
      providers: [provider("provider-a", "pinned", null)],
      credentials: [credential("credential-old", "missing-provider", "disconnected")],
      defaults: [],
      attempts: noAttempts,
      revocationJobs: noRevocations,
      validateEnvelopes: false,
    })).toThrow("credential provenance is dangling or adapter-mismatched");
  });
});

describe("Provider-owned credential forward migration contract", () => {
  it("registers an immutable 0049/data/0050 sequence", () => {
    const expandEntryIndex = schemaJournal.entries.findIndex(
      (entry) => entry.tag === "0049_provider_owned_credentials_expand",
    );
    const contractEntryIndex = schemaJournal.entries.findIndex(
      (entry) => entry.tag === "0050_provider_owned_credentials_contract",
    );
    expect(schemaJournal.entries[expandEntryIndex]).toEqual(expect.objectContaining({
      idx: 49,
      tag: "0049_provider_owned_credentials_expand",
    }));
    expect(schemaJournal.entries[contractEntryIndex]).toEqual(expect.objectContaining({
      idx: 50,
      tag: "0050_provider_owned_credentials_contract",
    }));
    expect(contractEntryIndex).toBe(expandEntryIndex + 1);

    const dataEntry = dataJournal.entries.find(
      (entry) => entry.migrationKey === "provider-owned-credentials-v1",
    );
    expect(dataEntry).toEqual(expect.objectContaining({
      idx: 6,
      migrationKey: "provider-owned-credentials-v1",
      runner: "provider-owned-credentials.ts",
    }));
    expect(expand).toContain("'provider-owned-credentials-v1'");
    expect(expand).toContain("'ink-admin-provider-owned-credentials-v1'");
    expect(expand).toContain("'drizzle/data/provider-owned-credentials.ts'");
    expect(contract).toContain("migration_key = 'provider-owned-credentials-v1'");
  });

  it("guards the destructive contract before dropping only the empty defaults table", () => {
    const guard = contract.indexOf("DO $$");
    const dropDefaults = contract.indexOf('DROP TABLE "ai_provider_managed_account_defaults"');
    expect(guard).toBeGreaterThanOrEqual(0);
    expect(dropDefaults).toBeGreaterThan(guard);
    expect(contract).toContain("product defaults remain");
    expect(contract).toContain("live credential has no unique direct owner");
    expect(contract).toContain("credential ownership is dangling or adapter-mismatched");
    expect(contract).toContain("ai_provider_managed_credentials_live_provider_uidx");
    expect(contract).toContain("ai_providers_managed_credential_owner_fk");
    expect(contract).not.toContain('DROP INDEX "ai_provider_managed_credentials_active_identity_uidx"');
    expect(contract).not.toContain("DROP TABLE \"ai_provider_managed_account_defaults\" CASCADE");
    expect(contract).not.toMatch(/(?:DELETE FROM|UPDATE)\s+(?:"?ai_provider_managed_credentials"?|"?gateway_requests"?)/i);
  });

  it("keeps the final typed schema Provider-owned and omits default routing", () => {
    expect(contractSnapshot.tables["public.ai_provider_managed_account_defaults"]).toBeUndefined();
    expect(schema).not.toContain("export const aiProviderManagedAccountDefaults");
    expect(schema).toContain("ai_provider_managed_credentials_live_provider_uidx");
    expect(schema).toContain("ai_provider_managed_credentials_active_identity_uidx");
    expect(schema).toContain("ai_provider_managed_credentials_live_owner_check");
    expect(schema).toContain("ai_providers_managed_credential_owner_fk");
    expect(schema).not.toContain("managed_account_binding_mode} = 'follow_default'");
  });

  it("is dry-run-first, locked, redacted, and leaves live token material byte-stable", () => {
    expect(migrationCore).toContain('arguments_.includes("--apply")');
    expect(migrationCore).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(migrationCore).toContain("pg_advisory_xact_lock");
    expect(migrationCore).toContain("IN SHARE ROW EXCLUSIVE MODE");
    expect(migrationCore).toContain('else await client.query("ROLLBACK")');
    expect(migrationCore).toContain("recordProviderOwnedCredentialsReceipt");
    expect(migrationCore).toContain('status: "blocked"');
    expect(migrationCore).toContain("failureCode: error.failureCode");
    expect(migrationCore).toContain("credentialsCloned: 0");
    expect(migrationCore).toContain("credentialsDeleted: 0");
    expect(migrationCore).toContain("credentialsReencrypted: 0");
    expect(migrationCore).not.toMatch(/SET[\s\S]{0,160}bundle_ciphertext/i);
    expect(migrationCore).not.toMatch(/DELETE FROM ai_provider_managed_credentials/i);
    expect(migrationCore).not.toMatch(/UPDATE gateway_requests/i);
    expect(registry).toContain("recordProviderOwnedCredentialsReceipt");
    expect(registry).toContain("Unexpected Provider-owned credential migration receipt");
  });

  it("ships thin source and compiled CLIs without a second database target", () => {
    expect(sourceCli).toContain('from "./provider-owned-credentials-core"');
    expect(sourceCli).not.toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(packageCli).toContain('from "../../../drizzle/data/provider-owned-credentials-core"');
    expect(packageCli).toContain('from "./migration-runtime.js"');
    expect(packageCli).toContain("databaseUrl: connection.connectionString");
    expect(packageCli).toContain("await connection.stop()");
    expect(databasePackage.exports["./provider-owned-credentials-data"]).toBe(
      "./dist/provider-owned-credentials-data.js",
    );
    expect(databasePackage.scripts["build:provider-owned-credentials-data"]).toContain(
      "dist/provider-owned-credentials-data.js",
    );
  });
});
