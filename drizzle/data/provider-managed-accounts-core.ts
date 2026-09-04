// [Input] 0047-expanded Provider-owned managed credentials/attempts/revocation jobs and deployment credential secrets.
// [Output] Secret-configuration preflight or transactional account-scoped AAD/HMAC/binding cutover with a content-free aggregate receipt.
// [Pos] Shared Provider managed-account data migration core used by source and compiled CLI entrypoints.
// [Sync] 2026-09-04: preflight key and identity-pepper readiness before the release workflow mutates schema.
import {
  createHash,
  createHmac,
} from "node:crypto";
import { resolve } from "node:path";

import { config } from "dotenv";
import pg, { type PoolClient } from "pg";

import {
  decryptCredentialEnvelope,
  encryptCredentialEnvelope,
  type EncryptedCredentialEnvelope,
} from "../../app/lib/security/credential-envelope";
import { getCredentialEncryptionKey } from "../../app/lib/security/credential-encryption";
import { providerTokenBundleSchema } from "../../app/lib/providers/schemas";
import type {
  ProviderProductKind,
  ProviderTokenBundle,
} from "../../app/lib/providers/types";
import {
  PROVIDER_MANAGED_ACCOUNTS_CONTRACT,
  PROVIDER_MANAGED_ACCOUNTS_KEY,
  recordProviderManagedAccountsReceipt,
} from "./registry.mjs";

const TERMINAL_REVOCATION_STATUSES = new Set(["succeeded", "unsupported"]);

type ProviderManagedAccountsReceipt = Readonly<{
  contract: string;
  mode: "applied" | "dry-run";
  sourceTableCount: number;
  sourceRowCount: number;
  providerRows: number;
  credentialRows: number;
  attemptRows: number;
  revocationJobRows: number;
  changedRows: number;
  providerRowsChanged: number;
  providersPinned: number;
  providersFollowingDefault: number;
  credentialRowsChanged: number;
  credentialsReencrypted: number;
  identitiesRehashed: number;
  identitiesCleared: number;
  attemptRowsChanged: number;
  attemptsTerminated: number;
  attemptContextsBackfilled: number;
  revocationRowsChanged: number;
  revocationJobsScoped: number;
  remainingActiveAttempts: number;
  remainingNonTerminalRevocationJobs: number;
  sourceFingerprintSha256: string;
  redacted: true;
}>;

type ManagedCredentialRow = {
  id: string;
  provider_id: string | null;
  adapter_kind: ProviderProductKind;
  status: "connected" | "reauth_required" | "disconnected";
  auth_epoch: number;
  revision: number;
  envelope_context_id: string | null;
  bundle_format_version: number | null;
  bundle_key_id: string | null;
  bundle_ciphertext: string | null;
  bundle_nonce: string | null;
  bundle_tag: string | null;
  account_identity_hash: string | null;
};

type ProviderRow = {
  id: string;
  adapter_kind: ProviderProductKind;
  managed_account_binding_mode: "follow_default" | "pinned" | null;
  managed_credential_id: string | null;
};

type AttemptRow = {
  id: string;
  adapter_kind: ProviderProductKind;
  status: "starting" | "pending" | "succeeded" | "denied" | "expired" | "cancelled" | "failed";
  envelope_context_id: string | null;
};

type RevocationJobRow = {
  id: string;
  adapter_kind: ProviderProductKind;
  source_kind: "credential" | "attempt";
  source_record_id: string;
  status: "pending" | "processing" | "succeeded" | "failed" | "unsupported";
  account_scope_id: string | null;
  managed_credential_id: string | null;
  credential_auth_epoch: number | null;
  envelope_context_id: string | null;
  bundle_format_version: number | null;
  bundle_key_id: string | null;
  bundle_ciphertext: string | null;
  bundle_nonce: string | null;
  bundle_tag: string | null;
};

export type ManagedCredentialTransform = Readonly<{
  envelope: EncryptedCredentialEnvelope | null;
  identityHash: string | null;
  reencrypt: boolean;
  identityChanged: boolean;
  contextChanged: boolean;
}>;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalManagedAccountIdentity(
  adapterKind: ProviderProductKind,
  bundle: ProviderTokenBundle,
) {
  if (bundle.product !== adapterKind) {
    throw new Error("Managed credential product does not match its adapter");
  }
  if (bundle.product === "codex") {
    const subject = bundle.identity.subject.trim();
    const chatgptAccountId = bundle.identity.chatgptAccountId.trim();
    if (!subject || !chatgptAccountId) {
      throw new Error("Managed credential identity is invalid");
    }
    return canonicalJson({ subject, chatgptAccountId });
  }
  if (bundle.product === "xai") {
    const subject = bundle.identity.subject.trim();
    if (!subject) throw new Error("Managed credential identity is invalid");
    return canonicalJson({ subject });
  }
  const numericId = String(bundle.identity.numericId);
  if (!/^\d+$/.test(numericId)) {
    throw new Error("Managed credential identity is invalid");
  }
  return canonicalJson({ host: "github.com", numericId });
}

function identityPepper() {
  const value = process.env.AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER?.trim();
  if (!value || Buffer.byteLength(value, "utf8") < 32) {
    throw new Error(
      "AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER must contain at least 32 bytes",
    );
  }
  return value;
}

export function managedAccountIdentityHash(
  adapterKind: ProviderProductKind,
  bundle: ProviderTokenBundle,
  pepper = identityPepper(),
) {
  const canonicalIdentity = canonicalManagedAccountIdentity(adapterKind, bundle);
  return `hmac-sha256:${createHmac("sha256", pepper)
    .update(`${adapterKind}\0${canonicalIdentity}`, "utf8")
    .digest("hex")}`;
}

function envelopeFromCredential(row: ManagedCredentialRow) {
  if (
    row.bundle_format_version !== 1
    || !row.bundle_key_id
    || !row.bundle_ciphertext
    || !row.bundle_nonce
    || !row.bundle_tag
  ) {
    throw new Error("Managed credential envelope is incomplete");
  }
  return {
    formatVersion: 1 as const,
    keyId: row.bundle_key_id,
    ciphertext: row.bundle_ciphertext,
    nonce: row.bundle_nonce,
    tag: row.bundle_tag,
  };
}

function hasCredentialEnvelope(row: ManagedCredentialRow) {
  const fields = [
    row.bundle_format_version,
    row.bundle_key_id,
    row.bundle_ciphertext,
    row.bundle_nonce,
    row.bundle_tag,
  ];
  const present = fields.filter((value) => value !== null).length;
  if (present !== 0 && present !== fields.length) {
    throw new Error("Managed credential envelope is incomplete");
  }
  return present === fields.length;
}

export function transformManagedCredential(
  row: ManagedCredentialRow,
  options: Readonly<{ apply: boolean; pepper?: string }>,
): ManagedCredentialTransform {
  const hasEnvelope = hasCredentialEnvelope(row);
  if (row.status === "connected" && !hasEnvelope) {
    throw new Error("Connected managed credential has no encrypted bundle");
  }
  if (!hasEnvelope) {
    return {
      envelope: null,
      identityHash: null,
      reencrypt: false,
      identityChanged: row.account_identity_hash !== null,
      contextChanged: row.envelope_context_id !== row.id,
    };
  }

  const sourceContextId = row.envelope_context_id?.trim() || row.provider_id?.trim();
  if (!sourceContextId || ![row.id, row.provider_id].includes(sourceContextId)) {
    throw new Error("Managed credential envelope context is not recognized");
  }
  const bundle = decryptCredentialEnvelope(
    envelopeFromCredential(row),
    {
      providerId: sourceContextId,
      adapterKind: row.adapter_kind,
      recordKind: "credential",
      recordId: row.id,
      revision: row.revision,
    },
    providerTokenBundleSchema,
  );
  const identityHash = managedAccountIdentityHash(
    row.adapter_kind,
    bundle,
    options.pepper,
  );
  const reencrypt = sourceContextId !== row.id;
  const envelope = reencrypt && options.apply
    ? encryptCredentialEnvelope(
      bundle,
      {
        providerId: row.id,
        adapterKind: row.adapter_kind,
        recordKind: "credential",
        recordId: row.id,
        revision: row.revision,
      },
      providerTokenBundleSchema,
    )
    : null;
  if (envelope) {
    // Authenticate the new envelope before the transaction replaces the old one.
    decryptCredentialEnvelope(
      envelope,
      {
        providerId: row.id,
        adapterKind: row.adapter_kind,
        recordKind: "credential",
        recordId: row.id,
        revision: row.revision,
      },
      providerTokenBundleSchema,
    );
  }
  return {
    envelope,
    identityHash,
    reencrypt,
    identityChanged: row.account_identity_hash !== identityHash,
    contextChanged: row.envelope_context_id !== row.id,
  };
}

function targetDatabaseUrl() {
  const raw = process.env.MIGRATION_DATABASE_URL;
  if (!raw) throw new Error("MIGRATION_DATABASE_URL is required");
  const parsed = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Provider managed-account migration requires PostgreSQL");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const testMarkers = new Set(databaseName.toLowerCase().split(/[^a-z0-9]+/));
  const safeTestName = ["codex", "test", "tests", "tmp", "temp", "ci", "sandbox"]
    .some((marker) => testMarkers.has(marker));
  if (!localHosts.has(parsed.hostname)
    || (databaseName !== "ink-memory" && !safeTestName)) {
    throw new Error("Provider managed-account migration rejected the database safety identity");
  }
  return raw;
}

function fingerprintEntry(hash: ReturnType<typeof createHash>, value: unknown) {
  hash.update(canonicalJson(value)).update("\n");
}

async function assertExpandDefinition(client: PoolClient) {
  const definition = await client.query<{
    runner_contract: string;
    runner_path: string;
    expected_table_count: number | null;
  }>(
    `SELECT runner_contract, runner_path, expected_table_count
       FROM drizzle.data_migration_definitions
      WHERE migration_key = $1
      FOR SHARE`,
    [PROVIDER_MANAGED_ACCOUNTS_KEY],
  );
  const row = definition.rows[0];
  if (
    row?.runner_contract !== PROVIDER_MANAGED_ACCOUNTS_CONTRACT
    || row.runner_path !== "drizzle/data/provider-managed-accounts.ts"
    || Number(row.expected_table_count) !== 4
  ) {
    throw new Error("Apply exact Drizzle migration 0047 before the managed-account data migration");
  }
}

function assertNoLiveRevocationJobs(rows: readonly RevocationJobRow[]) {
  if (rows.some((row) => !TERMINAL_REVOCATION_STATUSES.has(row.status))) {
    throw new Error(
      "Provider managed-account migration requires all revocation jobs to be terminal",
    );
  }
  for (const row of rows) {
    if (
      row.bundle_format_version !== null
      || row.bundle_key_id !== null
      || row.bundle_ciphertext !== null
      || row.bundle_nonce !== null
      || row.bundle_tag !== null
    ) {
      throw new Error("Terminal revocation job retained encrypted material");
    }
  }
}

async function verifyContractReady(client: PoolClient) {
  const verification = await client.query<{
    invalid_providers: number;
    invalid_credentials: number;
    active_attempts: number;
    invalid_attempt_contexts: number;
    invalid_revocations: number;
    duplicate_identities: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM ai_providers
         WHERE adapter_kind IN ('codex', 'xai', 'github_copilot')
           AND (managed_account_binding_mode IS NULL
             OR (managed_account_binding_mode = 'pinned' AND managed_credential_id IS NULL)
             OR (managed_account_binding_mode = 'follow_default' AND managed_credential_id IS NOT NULL)))
         AS invalid_providers,
       (SELECT count(*)::int FROM ai_provider_managed_credentials
         WHERE envelope_context_id IS DISTINCT FROM id
            OR (status = 'connected' AND account_identity_hash IS NULL)
            OR (account_identity_hash IS NOT NULL
              AND account_identity_hash !~ '^hmac-sha256:[0-9a-f]{64}$'))
         AS invalid_credentials,
       (SELECT count(*)::int FROM ai_provider_auth_attempts
         WHERE status IN ('starting', 'pending')) AS active_attempts,
       (SELECT count(*)::int FROM ai_provider_auth_attempts
         WHERE envelope_context_id IS DISTINCT FROM id) AS invalid_attempt_contexts,
       (SELECT count(*)::int FROM ai_provider_revocation_jobs
         WHERE status IN ('pending', 'processing', 'failed')
            OR account_scope_id IS NULL
            OR envelope_context_id IS DISTINCT FROM account_scope_id
            OR ((managed_credential_id IS NULL) <> (credential_auth_epoch IS NULL)))
         AS invalid_revocations,
       (SELECT count(*)::int FROM (
          SELECT adapter_kind, account_identity_hash
            FROM ai_provider_managed_credentials
           WHERE account_identity_hash IS NOT NULL
             AND status IN ('connected', 'reauth_required')
           GROUP BY adapter_kind, account_identity_hash
          HAVING count(*) > 1
       ) AS duplicate_groups) AS duplicate_identities`,
  );
  const row = verification.rows[0];
  if (!row || Object.values(row).some((value) => Number(value) !== 0)) {
    throw new Error("Provider managed-account migration verification failed");
  }
}

async function migrate(client: PoolClient, apply: boolean): Promise<ProviderManagedAccountsReceipt> {
  await assertExpandDefinition(client);
  const providersResult = await client.query<ProviderRow>(
    `SELECT id, adapter_kind, managed_account_binding_mode, managed_credential_id
       FROM ai_providers
      WHERE adapter_kind IN ('codex', 'xai', 'github_copilot')
      ORDER BY id
      FOR UPDATE`,
  );
  const credentialsResult = await client.query<ManagedCredentialRow>(
    `SELECT id, provider_id, adapter_kind, status, auth_epoch, revision,
            envelope_context_id, bundle_format_version, bundle_key_id,
            bundle_ciphertext, bundle_nonce, bundle_tag, account_identity_hash
       FROM ai_provider_managed_credentials
      ORDER BY id
      FOR UPDATE`,
  );
  const attemptsResult = await client.query<AttemptRow>(
    `SELECT id, adapter_kind, status, envelope_context_id
       FROM ai_provider_auth_attempts
      ORDER BY id
      FOR UPDATE`,
  );
  const jobsResult = await client.query<RevocationJobRow>(
    `SELECT id, adapter_kind, source_kind, source_record_id, status,
            account_scope_id, managed_credential_id, credential_auth_epoch,
            envelope_context_id, bundle_format_version, bundle_key_id,
            bundle_ciphertext, bundle_nonce, bundle_tag
       FROM ai_provider_revocation_jobs
      ORDER BY id
      FOR UPDATE`,
  );
  const providers = providersResult.rows as ProviderRow[];
  const credentials = credentialsResult.rows as ManagedCredentialRow[];
  const attempts = attemptsResult.rows as AttemptRow[];
  const jobs = jobsResult.rows as RevocationJobRow[];
  assertNoLiveRevocationJobs(jobs);

  const fingerprint = createHash("sha256");
  const credentialsById = new Map(credentials.map((row) => [row.id, row]));
  const credentialsByProvider = new Map<string, ManagedCredentialRow>();
  for (const credential of credentials) {
    if (credential.provider_id && credentialsByProvider.has(credential.provider_id)) {
      throw new Error("A legacy Provider owns more than one managed credential");
    }
    if (credential.provider_id) credentialsByProvider.set(credential.provider_id, credential);
  }

  let providersPinned = 0;
  let providersFollowingDefault = 0;
  let providerRowsChanged = 0;
  for (const provider of providers) {
    const legacyCredential = credentialsByProvider.get(provider.id) ?? null;
    const desiredMode = provider.managed_account_binding_mode
      ?? (legacyCredential ? "pinned" : "follow_default");
    const desiredCredentialId = desiredMode === "pinned"
      ? (provider.managed_credential_id ?? legacyCredential?.id ?? null)
      : null;
    const desiredCredential = desiredCredentialId
      ? credentialsById.get(desiredCredentialId)
      : null;
    if (desiredMode === "pinned"
      && (!desiredCredential || desiredCredential.adapter_kind !== provider.adapter_kind)) {
      throw new Error("Pinned Provider account binding is invalid");
    }
    const changed = provider.managed_account_binding_mode !== desiredMode
      || provider.managed_credential_id !== desiredCredentialId;
    if (changed) {
      providerRowsChanged += 1;
      if (desiredMode === "pinned") providersPinned += 1;
      else providersFollowingDefault += 1;
      if (apply) {
        await client.query(
          `UPDATE ai_providers
              SET managed_account_binding_mode = $2,
                  managed_credential_id = $3,
                  updated_at = NOW()
            WHERE id = $1`,
          [provider.id, desiredMode, desiredCredentialId],
        );
      }
    }
    fingerprintEntry(fingerprint, [
      "provider",
      provider.id,
      provider.adapter_kind,
      desiredMode,
      desiredCredentialId,
    ]);
  }

  let credentialRowsChanged = 0;
  let credentialsReencrypted = 0;
  let identitiesRehashed = 0;
  let identitiesCleared = 0;
  const activeIdentities = new Set<string>();
  const legacyActiveIdentities = new Set<string>();
  for (const credential of credentials) {
    if (!credential.account_identity_hash
      || !["connected", "reauth_required"].includes(credential.status)) continue;
    const legacyKey = `${credential.adapter_kind}\0${credential.account_identity_hash}`;
    if (legacyActiveIdentities.has(legacyKey)) {
      throw new Error("Duplicate active managed-account identity blocks migration");
    }
    legacyActiveIdentities.add(legacyKey);
  }
  for (const credential of credentials) {
    const transformed = transformManagedCredential(credential, { apply });
    const changed = transformed.reencrypt
      || transformed.identityChanged
      || transformed.contextChanged;
    if (transformed.reencrypt) credentialsReencrypted += 1;
    if (transformed.identityChanged && transformed.identityHash) identitiesRehashed += 1;
    if (transformed.identityChanged && !transformed.identityHash) identitiesCleared += 1;
    if (transformed.identityHash && ["connected", "reauth_required"].includes(credential.status)) {
      const uniquenessKey = `${credential.adapter_kind}\0${transformed.identityHash}`;
      if (activeIdentities.has(uniquenessKey)) {
        throw new Error("Duplicate active managed-account identity blocks migration");
      }
      activeIdentities.add(uniquenessKey);
    }
    if (changed) {
      credentialRowsChanged += 1;
      if (apply) {
        if (transformed.reencrypt && !transformed.envelope) {
          throw new Error("Managed credential envelope replacement was not produced");
        }
        if (transformed.envelope) {
          await client.query(
            `UPDATE ai_provider_managed_credentials
                SET envelope_context_id = id,
                    bundle_format_version = $2, bundle_key_id = $3,
                    bundle_ciphertext = $4, bundle_nonce = $5, bundle_tag = $6,
                    account_identity_hash = $7, updated_at = NOW()
              WHERE id = $1`,
            [
              credential.id,
              transformed.envelope.formatVersion,
              transformed.envelope.keyId,
              transformed.envelope.ciphertext,
              transformed.envelope.nonce,
              transformed.envelope.tag,
              transformed.identityHash,
            ],
          );
        } else {
          await client.query(
            `UPDATE ai_provider_managed_credentials
                SET envelope_context_id = id,
                    account_identity_hash = $2,
                    updated_at = NOW()
              WHERE id = $1`,
            [credential.id, transformed.identityHash],
          );
        }
      }
    }
    fingerprintEntry(fingerprint, [
      "credential",
      credential.id,
      credential.provider_id,
      credential.adapter_kind,
      credential.status,
      credential.auth_epoch,
      credential.revision,
      transformed.identityHash,
    ]);
  }

  let attemptsTerminated = 0;
  let attemptContextsBackfilled = 0;
  let attemptRowsChanged = 0;
  for (const attempt of attempts) {
    const active = attempt.status === "starting" || attempt.status === "pending";
    const contextChanged = attempt.envelope_context_id !== attempt.id;
    if (active) attemptsTerminated += 1;
    if (contextChanged) attemptContextsBackfilled += 1;
    if (active || contextChanged) {
      attemptRowsChanged += 1;
      if (apply) {
        await client.query(
          `UPDATE ai_provider_auth_attempts
              SET status = CASE WHEN status IN ('starting', 'pending') THEN 'cancelled' ELSE status END,
                  revision = revision + 1,
                  envelope_context_id = id,
                  state_hash = NULL,
                  bundle_format_version = NULL, bundle_key_id = NULL,
                  bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
                  redirect_uri = NULL, verification_uri = NULL, expires_at = NULL,
                  poll_interval_seconds = NULL, next_poll_at = NULL,
                  operation_lease_id = NULL, operation_lease_expires_at = NULL,
                  failure_code = CASE WHEN status IN ('starting', 'pending') THEN NULL ELSE failure_code END,
                  consumed_at = CASE
                    WHEN status IN ('starting', 'pending') THEN NOW()
                    ELSE consumed_at
                  END,
                  updated_at = NOW()
            WHERE id = $1`,
          [attempt.id],
        );
      }
    }
    fingerprintEntry(fingerprint, ["attempt", attempt.id, attempt.adapter_kind]);
  }

  let revocationJobsScoped = 0;
  let revocationRowsChanged = 0;
  for (const job of jobs) {
    const sourceCredential = job.source_kind === "credential"
      ? credentialsById.get(job.source_record_id) ?? null
      : null;
    const accountScopeId = job.account_scope_id ?? job.source_record_id;
    const managedCredentialId = job.managed_credential_id ?? sourceCredential?.id ?? null;
    const credentialAuthEpoch = managedCredentialId
      ? (job.credential_auth_epoch ?? credentialsById.get(managedCredentialId)?.auth_epoch ?? null)
      : null;
    if (managedCredentialId && !credentialAuthEpoch) {
      throw new Error("Revocation job account epoch cannot be recovered");
    }
    const changed = job.account_scope_id !== accountScopeId
      || job.managed_credential_id !== managedCredentialId
      || job.credential_auth_epoch !== credentialAuthEpoch
      || job.envelope_context_id !== accountScopeId;
    if (changed) {
      revocationRowsChanged += 1;
      revocationJobsScoped += 1;
      if (apply) {
        await client.query(
          `UPDATE ai_provider_revocation_jobs
              SET account_scope_id = $2,
                  managed_credential_id = $3,
                  credential_auth_epoch = $4,
                  envelope_context_id = $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [job.id, accountScopeId, managedCredentialId, credentialAuthEpoch],
        );
      }
    }
    fingerprintEntry(fingerprint, [
      "revocation",
      job.id,
      job.adapter_kind,
      job.source_kind,
      job.source_record_id,
      accountScopeId,
      managedCredentialId,
    ]);
  }

  const sourceRowCount = providers.length + credentials.length + attempts.length + jobs.length;
  const changedRows = providerRowsChanged
    + credentialRowsChanged
    + attemptRowsChanged
    + revocationRowsChanged;
  if (apply) await verifyContractReady(client);
  return {
    contract: PROVIDER_MANAGED_ACCOUNTS_CONTRACT,
    mode: apply ? "applied" : "dry-run",
    sourceTableCount: 4,
    sourceRowCount,
    providerRows: providers.length,
    credentialRows: credentials.length,
    attemptRows: attempts.length,
    revocationJobRows: jobs.length,
    changedRows,
    providerRowsChanged,
    providersPinned,
    providersFollowingDefault,
    credentialRowsChanged,
    credentialsReencrypted,
    identitiesRehashed,
    identitiesCleared,
    attemptRowsChanged,
    attemptsTerminated,
    attemptContextsBackfilled,
    revocationRowsChanged,
    revocationJobsScoped,
    remainingActiveAttempts: apply ? 0 : attemptsTerminated,
    remainingNonTerminalRevocationJobs: 0,
    sourceFingerprintSha256: fingerprint.digest("hex"),
    redacted: true,
  };
}

export async function runProviderManagedAccountsMigration(
  options: Readonly<{ apply: boolean; databaseUrl?: string }>,
) {
  const databaseUrl = options.databaseUrl ?? targetDatabaseUrl();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let receipt: ProviderManagedAccountsReceipt;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [PROVIDER_MANAGED_ACCOUNTS_KEY],
    );
    receipt = await migrate(client, options.apply);
    if (options.apply) await client.query("COMMIT");
    else await client.query("ROLLBACK");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
  const registry = options.apply
    ? await recordProviderManagedAccountsReceipt(databaseUrl, receipt)
    : null;
  return { ...receipt, registry };
}

export async function runProviderManagedAccountsCli(
  arguments_: readonly string[] = process.argv.slice(2),
  options: Readonly<{ databaseUrl?: string }> = {},
) {
  config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
  const allowedArguments = new Set(["--apply", "--preflight"]);
  for (const argument of arguments_) {
    if (!allowedArguments.has(argument)) {
      throw new Error(
        "Usage: provider-managed-accounts-data [--apply|--preflight]",
      );
    }
  }
  if (arguments_.includes("--preflight")) {
    if (arguments_.length !== 1) {
      throw new Error("--preflight cannot be combined with another argument");
    }
    getCredentialEncryptionKey();
    identityPepper();
    console.log(JSON.stringify({
      contract: PROVIDER_MANAGED_ACCOUNTS_CONTRACT,
      status: "ready",
      redacted: true,
    }));
    return;
  }
  const result = await runProviderManagedAccountsMigration({
    apply: arguments_.includes("--apply"),
    databaseUrl: options.databaseUrl,
  });
  console.log(JSON.stringify(result));
}

export function reportProviderManagedAccountsCliFailure() {
  console.error(JSON.stringify({
    contract: PROVIDER_MANAGED_ACCOUNTS_CONTRACT,
    status: "failed",
    redacted: true,
  }));
  process.exitCode = 1;
}
