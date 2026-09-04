// [Input] Legacy Provider-AAD credential envelopes and the 0047/0048/shared-core/CLI source contracts.
// [Output] Provider-free proof of account-AAD re-encryption, keyed identity hashing, configuration preflight, dry-run safety, and deployable cutover gates.
// [Pos] Focused contract test for the provider-managed-accounts-v1 core and both thin entrypoints.
// [Sync] 2026-09-04: require a bundled @ink-memory/db CLI targeting only MIGRATION_DATABASE_URL.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CredentialEnvelopeError,
  decryptCredentialEnvelope,
  encryptCredentialEnvelope,
} from "../security/credential-envelope";
import { providerTokenBundleSchema } from "../providers/schemas";
import {
  canonicalManagedAccountIdentity,
  managedAccountIdentityHash,
  transformManagedCredential,
} from "../../../drizzle/data/provider-managed-accounts";

const compatibilityRunner = readFileSync(
  resolve(process.cwd(), "drizzle/data/provider-managed-accounts.ts"),
  "utf8",
);
const migrationCore = readFileSync(
  resolve(process.cwd(), "drizzle/data/provider-managed-accounts-core.ts"),
  "utf8",
);
const packageCli = readFileSync(
  resolve(process.cwd(), "packages/db/src/provider-managed-accounts-data-cli.ts"),
  "utf8",
);
const databasePackage = JSON.parse(readFileSync(
  resolve(process.cwd(), "packages/db/package.json"),
  "utf8",
)) as {
  exports: Record<string, string>;
  scripts: Record<string, string>;
};
const registry = readFileSync(
  resolve(process.cwd(), "drizzle/data/registry.mjs"),
  "utf8",
);
const expand = readFileSync(
  resolve(process.cwd(), "drizzle/0047_provider_managed_accounts_expand.sql"),
  "utf8",
);
const contract = readFileSync(
  resolve(process.cwd(), "drizzle/0048_provider_managed_accounts_contract.sql"),
  "utf8",
);

const bundle = providerTokenBundleSchema.parse({
  product: "codex",
  accessToken: "access-secret-for-test",
  refreshToken: "refresh-secret-for-test",
  expiresAtMs: 2_000_000_000_000,
  grantedScopes: ["openid", "offline_access"],
  identity: {
    subject: " subject-1 ",
    chatgptAccountId: " account-1 ",
  },
});

describe("Provider managed-account credential transform", () => {
  beforeEach(() => {
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = "41".repeat(32);
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY_ID = "managed-account-test-key";
    process.env.AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER = "pepper-for-test-managed-accounts-123456789";
  });

  afterEach(() => {
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY_ID;
    delete process.env.AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER;
  });

  it("authenticates legacy Provider AAD and replaces it with account ID AAD", () => {
    const legacyEnvelope = encryptCredentialEnvelope(
      bundle,
      {
        providerId: "provider-legacy",
        adapterKind: "codex",
        recordKind: "credential",
        recordId: "account-1",
        revision: 3,
      },
      providerTokenBundleSchema,
    );
    const transformed = transformManagedCredential({
      id: "account-1",
      provider_id: "provider-legacy",
      adapter_kind: "codex",
      status: "connected",
      auth_epoch: 1,
      revision: 3,
      envelope_context_id: null,
      bundle_format_version: legacyEnvelope.formatVersion,
      bundle_key_id: legacyEnvelope.keyId,
      bundle_ciphertext: legacyEnvelope.ciphertext,
      bundle_nonce: legacyEnvelope.nonce,
      bundle_tag: legacyEnvelope.tag,
      account_identity_hash: "legacy-unkeyed-digest",
    }, { apply: true });

    expect(transformed).toMatchObject({
      reencrypt: true,
      contextChanged: true,
      identityChanged: true,
    });
    expect(transformed.identityHash).toMatch(/^hmac-sha256:[0-9a-f]{64}$/);
    expect(transformed.envelope).not.toBeNull();
    expect(decryptCredentialEnvelope(
      transformed.envelope!,
      {
        providerId: "account-1",
        adapterKind: "codex",
        recordKind: "credential",
        recordId: "account-1",
        revision: 3,
      },
      providerTokenBundleSchema,
    )).toEqual(bundle);
    expect(() => decryptCredentialEnvelope(
      transformed.envelope!,
      {
        providerId: "provider-legacy",
        adapterKind: "codex",
        recordKind: "credential",
        recordId: "account-1",
        revision: 3,
      },
      providerTokenBundleSchema,
    )).toThrowError(expect.objectContaining<Partial<CredentialEnvelopeError>>({
      code: "CREDENTIAL_ENVELOPE_AUTHENTICATION_FAILED",
    }));
  });

  it("plans but does not create replacement ciphertext during dry-run", () => {
    const legacyEnvelope = encryptCredentialEnvelope(
      bundle,
      {
        providerId: "provider-legacy",
        adapterKind: "codex",
        recordKind: "credential",
        recordId: "account-1",
        revision: 1,
      },
      providerTokenBundleSchema,
    );
    const transformed = transformManagedCredential({
      id: "account-1",
      provider_id: "provider-legacy",
      adapter_kind: "codex",
      status: "connected",
      auth_epoch: 1,
      revision: 1,
      envelope_context_id: "provider-legacy",
      bundle_format_version: 1,
      bundle_key_id: legacyEnvelope.keyId,
      bundle_ciphertext: legacyEnvelope.ciphertext,
      bundle_nonce: legacyEnvelope.nonce,
      bundle_tag: legacyEnvelope.tag,
      account_identity_hash: null,
    }, { apply: false });

    expect(transformed.reencrypt).toBe(true);
    expect(transformed.envelope).toBeNull();
    expect(transformed.identityHash).toBe(managedAccountIdentityHash("codex", bundle));
  });

  it("uses the runtime canonical identity projection and clears unrecoverable old hashes", () => {
    expect(canonicalManagedAccountIdentity("codex", bundle)).toBe(
      '{"chatgptAccountId":"account-1","subject":"subject-1"}',
    );
    expect(transformManagedCredential({
      id: "disconnected-account",
      provider_id: "provider-legacy",
      adapter_kind: "xai",
      status: "disconnected",
      auth_epoch: 2,
      revision: 4,
      envelope_context_id: null,
      bundle_format_version: null,
      bundle_key_id: null,
      bundle_ciphertext: null,
      bundle_nonce: null,
      bundle_tag: null,
      account_identity_hash: "legacy-unkeyed-digest",
    }, { apply: false })).toMatchObject({
      identityHash: null,
      identityChanged: true,
      contextChanged: true,
    });
  });
});

describe("Provider managed-account migration source contract", () => {
  it("is dry-run-first, transaction locked, secret-redacted, and receipt-backed", () => {
    expect(migrationCore).toContain('arguments_.includes("--apply")');
    expect(migrationCore).toContain('arguments_.includes("--preflight")');
    expect(migrationCore).toContain("getCredentialEncryptionKey()");
    expect(migrationCore).toContain("identityPepper()");
    expect(migrationCore).toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(migrationCore).toContain("pg_advisory_xact_lock");
    expect(migrationCore).toContain('else await client.query("ROLLBACK")');
    expect(migrationCore).toContain("recordProviderManagedAccountsReceipt");
    expect(migrationCore).toContain('status: "failed"');
    expect(migrationCore).not.toMatch(/console\.(?:log|error)\([^\n]*(?:bundle|ciphertext|databaseUrl)/);
    expect(registry).toContain("recordProviderManagedAccountsReceipt");
    expect(registry).toContain("Unexpected Provider managed-account migration receipt");
  });

  it("pins old credentials, cancels unsafe attempts, and blocks live revocation jobs", () => {
    expect(migrationCore).toContain('legacyCredential ? "pinned" : "follow_default"');
    expect(migrationCore).toContain("THEN 'cancelled'");
    expect(migrationCore).toContain("bundle_ciphertext = NULL");
    expect(migrationCore).toContain("requires all revocation jobs to be terminal");
    expect(migrationCore).toContain("envelope_context_id = $2");
    expect(migrationCore).toContain("job.envelope_context_id !== accountScopeId");
  });

  it("keeps source and compiled CLIs thin and targets the schema migration DSN only", () => {
    expect(compatibilityRunner).toContain('from "./provider-managed-accounts-core"');
    expect(compatibilityRunner).not.toContain("BEGIN ISOLATION LEVEL SERIALIZABLE");
    expect(packageCli).toContain('from "../../../drizzle/data/provider-managed-accounts-core"');
    expect(packageCli).toContain('from "./migration-runtime.js"');
    expect(packageCli).toContain("databaseUrl: connection.connectionString");
    expect(packageCli).toContain("await connection.stop()");
    expect(migrationCore).toContain("process.env.MIGRATION_DATABASE_URL");
    expect(migrationCore).not.toMatch(
      /process\.env\.(?:DATABASE_URL|TEST_DATABASE_URL|INK_USE_TEST_DATABASE_URL)/,
    );
    expect(databasePackage.scripts.build).toContain("build:provider-managed-accounts-data");
    expect(databasePackage.scripts["build:provider-managed-accounts-data"]).toContain(
      "dist/provider-managed-accounts-data.js",
    );
    expect(databasePackage.exports["./provider-managed-accounts-data"]).toBe(
      "./dist/provider-managed-accounts-data.js",
    );
  });

  it("keeps expand, runner, and contract receipt/AAD references aligned", () => {
    expect(expand).toContain("'provider-managed-accounts-v1'");
    expect(expand).toContain("'drizzle/data/provider-managed-accounts.ts'");
    expect(contract).toContain("migration_key = 'provider-managed-accounts-v1'");
    expect(contract).toContain("envelope_context_id IS DISTINCT FROM account_scope_id");
    expect(contract).toContain("account_identity_hash !~ '^hmac-sha256:[0-9a-f]{64}$'");
    expect(contract).toContain("status = 'connected' AND account_identity_hash IS NULL");
    expect(contract).not.toContain("envelope_context_id IS DISTINCT FROM id\n        OR account_scope_id");
  });
});
