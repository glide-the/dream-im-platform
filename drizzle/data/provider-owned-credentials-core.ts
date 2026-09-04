// [Input] 0049-expanded Provider account-pool rows plus the credential encryption key used only for envelope authentication.
// [Output] Dry-run or transactional direct-ownership cutover with aggregate-only, append-only audit receipt.
// [Pos] Shared provider-owned-credentials-v1 data migration core for source and compiled CLI entrypoints.
// [Sync] 2026-09-04: exclude Provider tombstones from effective-owner competition while preserving their history.
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { config } from "dotenv";
import pg, { type PoolClient } from "pg";

import { decryptCredentialEnvelope } from "../../app/lib/security/credential-envelope";
import { getCredentialEncryptionKey } from "../../app/lib/security/credential-encryption";
import { providerTokenBundleSchema } from "../../app/lib/providers/schemas";
import type { ProviderProductKind } from "../../app/lib/providers/types";
import {
  PROVIDER_OWNED_CREDENTIALS_CONTRACT,
  PROVIDER_OWNED_CREDENTIALS_KEY,
  recordProviderOwnedCredentialsReceipt,
} from "./registry.mjs";

const LIVE_CREDENTIAL_STATUSES = new Set(["connected", "reauth_required"]);
const ACTIVE_ATTEMPT_STATUSES = new Set(["starting", "pending"]);
const TERMINAL_REVOCATION_STATUSES = new Set(["succeeded", "unsupported"]);

export type ProviderOwnedProviderRow = Readonly<{
  id: string;
  adapter_kind: ProviderProductKind;
  status: "active" | "disabled" | "deleted";
  managed_account_binding_mode: "follow_default" | "pinned" | null;
  managed_credential_id: string | null;
}>;

export type ProviderOwnedCredentialRow = Readonly<{
  id: string;
  provider_id: string | null;
  adapter_kind: ProviderProductKind;
  status: "connected" | "reauth_required" | "disconnected";
  auth_epoch: number;
  revision: number;
  envelope_context_id: string;
  bundle_format_version: number | null;
  bundle_key_id: string | null;
  bundle_ciphertext: string | null;
  bundle_nonce: string | null;
  bundle_tag: string | null;
  account_identity_hash: string | null;
}>;

export type ProviderOwnedDefaultRow = Readonly<{
  adapter_kind: ProviderProductKind;
  credential_id: string;
  revision: number;
}>;

export type ProviderOwnedAttemptRow = Readonly<{
  id: string;
  provider_id: string;
  adapter_kind: ProviderProductKind;
  target_credential_id: string | null;
  status: "starting" | "pending" | "succeeded" | "denied" | "expired" | "cancelled" | "failed";
}>;

export type ProviderOwnedRevocationRow = Readonly<{
  id: string;
  provider_id: string;
  adapter_kind: ProviderProductKind;
  managed_credential_id: string | null;
  status: "pending" | "processing" | "succeeded" | "failed" | "unsupported";
  bundle_format_version: number | null;
  bundle_key_id: string | null;
  bundle_ciphertext: string | null;
  bundle_nonce: string | null;
  bundle_tag: string | null;
}>;

type ProviderTarget = Readonly<{
  providerId: string;
  credentialId: string | null;
  changed: boolean;
}>;

type CredentialTarget = Readonly<{
  credentialId: string;
  providerId: string;
  changed: boolean;
}>;

export type ProviderOwnedCredentialPlan = Readonly<{
  providerTargets: readonly ProviderTarget[];
  credentialTargets: readonly CredentialTarget[];
  providerRowsChanged: number;
  credentialRowsChanged: number;
  providersDirectBound: number;
  providersWithoutCredential: number;
  liveCredentialRows: number;
  disconnectedCredentialRows: number;
  sharedLiveCredentials: 0;
  orphanLiveCredentials: 0;
}>;

export type ProviderOwnedCredentialsReceipt = Readonly<{
  contract: string;
  mode: "applied" | "dry-run";
  sourceTableCount: 5;
  sourceRowCount: number;
  providerRows: number;
  credentialRows: number;
  defaultRows: number;
  attemptRows: number;
  revocationJobRows: number;
  changedRows: number;
  providerRowsChanged: number;
  credentialRowsChanged: number;
  defaultRowsChanged: number;
  providersDirectBound: number;
  providersWithoutCredential: number;
  credentialsReowned: number;
  defaultsCleared: number;
  liveCredentialRows: number;
  disconnectedCredentialRows: number;
  remainingSharedLiveCredentials: 0;
  remainingOrphanLiveCredentials: 0;
  remainingActiveAttempts: 0;
  remainingNonTerminalRevocationJobs: 0;
  credentialsCloned: 0;
  credentialsDeleted: 0;
  credentialsReencrypted: 0;
  sourceFingerprintSha256: string;
  redacted: true;
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

function fingerprintEntry(hash: ReturnType<typeof createHash>, value: unknown) {
  hash.update(canonicalJson(value)).update("\n");
}

export class ProviderOwnedCredentialMigrationBlockedError extends Error {
  readonly failureCode: string;
  readonly conflictCount: number | null;

  constructor(reason: string, count?: number) {
    const suffix = count === undefined ? "" : ` (${count})`;
    super(`Provider-owned credential migration blocked: ${reason}${suffix}`);
    this.name = "ProviderOwnedCredentialMigrationBlockedError";
    this.failureCode = reason.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    this.conflictCount = count ?? null;
  }
}

function failClosed(reason: string, count?: number): never {
  throw new ProviderOwnedCredentialMigrationBlockedError(reason, count);
}

function validateCredentialEnvelope(row: ProviderOwnedCredentialRow) {
  const fields = [
    row.bundle_format_version,
    row.bundle_key_id,
    row.bundle_ciphertext,
    row.bundle_nonce,
    row.bundle_tag,
  ];
  const present = fields.filter((value) => value !== null).length;
  if (present !== 0 && present !== fields.length) {
    failClosed("credential envelope is incomplete");
  }
  if (row.status === "connected" && present === 0) {
    failClosed("connected credential has no envelope");
  }
  if (present === 0) return;
  if (row.bundle_format_version !== 1 || row.envelope_context_id !== row.id) {
    failClosed("credential envelope context is invalid");
  }
  decryptCredentialEnvelope(
    {
      formatVersion: 1,
      keyId: row.bundle_key_id!,
      ciphertext: row.bundle_ciphertext!,
      nonce: row.bundle_nonce!,
      tag: row.bundle_tag!,
    },
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

export function planProviderOwnedCredentialCutover(input: Readonly<{
  providers: readonly ProviderOwnedProviderRow[];
  credentials: readonly ProviderOwnedCredentialRow[];
  defaults: readonly ProviderOwnedDefaultRow[];
  attempts: readonly ProviderOwnedAttemptRow[];
  revocationJobs: readonly ProviderOwnedRevocationRow[];
  validateEnvelopes?: boolean;
}>): ProviderOwnedCredentialPlan {
  const activeAttempts = input.attempts.filter((row) => (
    ACTIVE_ATTEMPT_STATUSES.has(row.status)
  )).length;
  if (activeAttempts > 0) failClosed("active auth attempts remain", activeAttempts);

  const nonTerminalRevocations = input.revocationJobs.filter((row) => (
    !TERMINAL_REVOCATION_STATUSES.has(row.status)
  )).length;
  if (nonTerminalRevocations > 0) {
    failClosed("non-terminal revocation jobs remain", nonTerminalRevocations);
  }
  if (input.revocationJobs.some((row) => (
    row.bundle_format_version !== null
    || row.bundle_key_id !== null
    || row.bundle_ciphertext !== null
    || row.bundle_nonce !== null
    || row.bundle_tag !== null
  ))) {
    failClosed("terminal revocation job retained encrypted material");
  }

  const providersById = new Map(input.providers.map((row) => [row.id, row]));
  if (providersById.size !== input.providers.length) {
    failClosed("duplicate Provider identity");
  }
  const credentialsById = new Map(input.credentials.map((row) => [row.id, row]));
  if (credentialsById.size !== input.credentials.length) {
    failClosed("duplicate credential identity");
  }
  const defaultsByAdapter = new Map<ProviderProductKind, ProviderOwnedDefaultRow>();
  for (const defaultRow of input.defaults) {
    if (defaultsByAdapter.has(defaultRow.adapter_kind)) {
      failClosed("duplicate adapter default");
    }
    const credential = credentialsById.get(defaultRow.credential_id);
    if (!credential || credential.adapter_kind !== defaultRow.adapter_kind) {
      failClosed("default credential is dangling or adapter-mismatched");
    }
    if (!LIVE_CREDENTIAL_STATUSES.has(credential.status)) {
      failClosed("default credential is not live");
    }
    defaultsByAdapter.set(defaultRow.adapter_kind, defaultRow);
  }

  for (const credential of input.credentials) {
    if (credential.provider_id) {
      const provenanceProvider = providersById.get(credential.provider_id);
      if (!provenanceProvider
        || provenanceProvider.adapter_kind !== credential.adapter_kind) {
        failClosed("credential provenance is dangling or adapter-mismatched");
      }
    }
    if (credential.envelope_context_id !== credential.id) {
      failClosed("credential envelope context is invalid");
    }
    if (credential.status === "connected" && !credential.account_identity_hash) {
      failClosed("connected credential identity is missing");
    }
    if (credential.account_identity_hash
      && !/^hmac-sha256:[0-9a-f]{64}$/.test(credential.account_identity_hash)) {
      failClosed("credential identity hash is invalid");
    }
    if (input.validateEnvelopes !== false) validateCredentialEnvelope(credential);
  }

  const ownerCandidates = new Map<string, string[]>();
  const providerTargets: ProviderTarget[] = [];
  for (const provider of input.providers) {
    if (provider.status === "deleted") {
      providerTargets.push({
        providerId: provider.id,
        credentialId: null,
        changed: provider.managed_account_binding_mode !== "pinned"
          || provider.managed_credential_id !== null,
      });
      continue;
    }
    let credentialId: string | null;
    if (provider.managed_account_binding_mode === "pinned") {
      credentialId = provider.managed_credential_id;
    } else if (provider.managed_account_binding_mode === "follow_default") {
      if (provider.managed_credential_id !== null) {
        failClosed("follow-default Provider also has a direct pointer");
      }
      credentialId = defaultsByAdapter.get(provider.adapter_kind)?.credential_id ?? null;
    } else {
      failClosed("Provider binding mode is missing or invalid");
    }

    if (credentialId) {
      const credential = credentialsById.get(credentialId);
      if (!credential || credential.adapter_kind !== provider.adapter_kind) {
        failClosed("Provider credential is dangling or adapter-mismatched");
      }
      if (!LIVE_CREDENTIAL_STATUSES.has(credential.status)) {
        failClosed("Provider points to a non-live credential");
      }
      const owners = ownerCandidates.get(credentialId) ?? [];
      owners.push(provider.id);
      ownerCandidates.set(credentialId, owners);
    }
    providerTargets.push({
      providerId: provider.id,
      credentialId,
      changed: provider.managed_account_binding_mode !== "pinned"
        || provider.managed_credential_id !== credentialId,
    });
  }

  let sharedLiveCredentials = 0;
  let orphanLiveCredentials = 0;
  const credentialTargets: CredentialTarget[] = [];
  for (const credential of input.credentials) {
    if (!LIVE_CREDENTIAL_STATUSES.has(credential.status)) continue;
    const owners = ownerCandidates.get(credential.id) ?? [];
    if (owners.length > 1) sharedLiveCredentials += 1;
    else if (owners.length === 0) orphanLiveCredentials += 1;
    else {
      credentialTargets.push({
        credentialId: credential.id,
        providerId: owners[0]!,
        changed: credential.provider_id !== owners[0],
      });
    }
  }
  if (sharedLiveCredentials > 0) {
    failClosed("shared live credentials require explicit reauthorization", sharedLiveCredentials);
  }
  if (orphanLiveCredentials > 0) {
    failClosed("orphan live credentials require explicit disposition", orphanLiveCredentials);
  }

  return {
    providerTargets,
    credentialTargets,
    providerRowsChanged: providerTargets.filter((row) => row.changed).length,
    credentialRowsChanged: credentialTargets.filter((row) => row.changed).length,
    providersDirectBound: providerTargets.filter((row) => row.credentialId !== null).length,
    providersWithoutCredential: providerTargets.filter((row) => row.credentialId === null).length,
    liveCredentialRows: credentialTargets.length,
    disconnectedCredentialRows: input.credentials.length - credentialTargets.length,
    sharedLiveCredentials: 0,
    orphanLiveCredentials: 0,
  };
}

function targetDatabaseUrl() {
  const raw = process.env.MIGRATION_DATABASE_URL;
  if (!raw) throw new Error("MIGRATION_DATABASE_URL is required");
  const parsed = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Provider-owned credential migration requires PostgreSQL");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const testMarkers = new Set(databaseName.toLowerCase().split(/[^a-z0-9]+/));
  const safeTestName = ["codex", "test", "tests", "tmp", "temp", "ci", "sandbox"]
    .some((marker) => testMarkers.has(marker));
  if (!localHosts.has(parsed.hostname)
    || (databaseName !== "ink-memory" && !safeTestName)) {
    throw new Error("Provider-owned credential migration rejected the database safety identity");
  }
  return raw;
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
    [PROVIDER_OWNED_CREDENTIALS_KEY],
  );
  const row = definition.rows[0];
  if (row?.runner_contract !== PROVIDER_OWNED_CREDENTIALS_CONTRACT
    || row.runner_path !== "drizzle/data/provider-owned-credentials.ts"
    || Number(row.expected_table_count) !== 5) {
    throw new Error("Apply exact Drizzle migration 0049 before the Provider-owned credential migration");
  }
}

async function verifyContractReady(client: PoolClient) {
  const result = await client.query<{
    invalid_providers: number;
    invalid_live_credentials: number;
    invalid_provenance: number;
    defaults_remaining: number;
    active_attempts: number;
    nonterminal_revocations: number;
  }>(
    `SELECT
       (SELECT count(*)::int
          FROM ai_providers p
          LEFT JOIN ai_provider_managed_credentials c
            ON c.id = p.managed_credential_id
           AND c.provider_id = p.id
           AND c.adapter_kind = p.adapter_kind
         WHERE p.adapter_kind IN ('codex', 'xai', 'github_copilot')
           AND (p.managed_account_binding_mode IS DISTINCT FROM 'pinned'
             OR (p.managed_credential_id IS NOT NULL
               AND (c.id IS NULL OR c.status NOT IN ('connected', 'reauth_required')))))
         AS invalid_providers,
       (SELECT count(*)::int
          FROM ai_provider_managed_credentials c
          LEFT JOIN ai_providers p
            ON p.id = c.provider_id
           AND p.adapter_kind = c.adapter_kind
           AND p.managed_credential_id = c.id
         WHERE c.status IN ('connected', 'reauth_required')
           AND p.id IS NULL)
         AS invalid_live_credentials,
       (SELECT count(*)::int
          FROM ai_provider_managed_credentials c
          LEFT JOIN ai_providers p
            ON p.id = c.provider_id
           AND p.adapter_kind = c.adapter_kind
         WHERE c.provider_id IS NOT NULL
           AND p.id IS NULL)
         AS invalid_provenance,
       (SELECT count(*)::int FROM ai_provider_managed_account_defaults)
         AS defaults_remaining,
       (SELECT count(*)::int FROM ai_provider_auth_attempts
         WHERE status IN ('starting', 'pending'))
         AS active_attempts,
       (SELECT count(*)::int FROM ai_provider_revocation_jobs
         WHERE status IN ('pending', 'processing', 'failed'))
         AS nonterminal_revocations`,
  );
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => Number(value) !== 0)) {
    throw new Error("Provider-owned credential migration verification failed");
  }
}

async function migrate(
  client: PoolClient,
  apply: boolean,
): Promise<ProviderOwnedCredentialsReceipt> {
  await assertExpandDefinition(client);
  await client.query(
    `LOCK TABLE ai_providers, ai_provider_managed_credentials,
       ai_provider_managed_account_defaults, ai_provider_auth_attempts,
       ai_provider_revocation_jobs IN SHARE ROW EXCLUSIVE MODE`,
  );
  const providers = (await client.query<ProviderOwnedProviderRow>(
    `SELECT id, adapter_kind, status, managed_account_binding_mode, managed_credential_id
       FROM ai_providers
      WHERE adapter_kind IN ('codex', 'xai', 'github_copilot')
      ORDER BY id
      FOR UPDATE`,
  )).rows;
  const credentials = (await client.query<ProviderOwnedCredentialRow>(
    `SELECT id, provider_id, adapter_kind, status, auth_epoch, revision,
            envelope_context_id, bundle_format_version, bundle_key_id,
            bundle_ciphertext, bundle_nonce, bundle_tag, account_identity_hash
       FROM ai_provider_managed_credentials
      ORDER BY id
      FOR UPDATE`,
  )).rows;
  const defaults = (await client.query<ProviderOwnedDefaultRow>(
    `SELECT adapter_kind, credential_id, revision
       FROM ai_provider_managed_account_defaults
      ORDER BY adapter_kind
      FOR UPDATE`,
  )).rows;
  const attempts = (await client.query<ProviderOwnedAttemptRow>(
    `SELECT id, provider_id, adapter_kind, target_credential_id, status
       FROM ai_provider_auth_attempts
      ORDER BY id
      FOR UPDATE`,
  )).rows;
  const revocationJobs = (await client.query<ProviderOwnedRevocationRow>(
    `SELECT id, provider_id, adapter_kind, managed_credential_id, status,
            bundle_format_version, bundle_key_id, bundle_ciphertext,
            bundle_nonce, bundle_tag
       FROM ai_provider_revocation_jobs
      ORDER BY id
      FOR UPDATE`,
  )).rows;

  const plan = planProviderOwnedCredentialCutover({
    providers,
    credentials,
    defaults,
    attempts,
    revocationJobs,
  });
  const fingerprint = createHash("sha256");
  for (const target of plan.providerTargets) {
    fingerprintEntry(fingerprint, ["provider", target.providerId, target.credentialId]);
  }
  const credentialTargets = new Map(
    plan.credentialTargets.map((target) => [target.credentialId, target]),
  );
  for (const credential of credentials) {
    fingerprintEntry(fingerprint, [
      "credential",
      credential.id,
      credential.adapter_kind,
      credential.status,
      credential.auth_epoch,
      credential.revision,
      credentialTargets.get(credential.id)?.providerId ?? credential.provider_id,
      credential.account_identity_hash,
    ]);
  }
  for (const attempt of attempts) {
    fingerprintEntry(fingerprint, ["attempt", attempt.id, attempt.status]);
  }
  for (const job of revocationJobs) {
    fingerprintEntry(fingerprint, ["revocation", job.id, job.status]);
  }

  if (apply) {
    for (const target of plan.providerTargets) {
      if (!target.changed) continue;
      await client.query(
        `UPDATE ai_providers
            SET managed_account_binding_mode = 'pinned',
                managed_credential_id = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [target.providerId, target.credentialId],
      );
    }
    for (const target of plan.credentialTargets) {
      if (!target.changed) continue;
      await client.query(
        `UPDATE ai_provider_managed_credentials
            SET provider_id = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [target.credentialId, target.providerId],
      );
    }
    await client.query("DELETE FROM ai_provider_managed_account_defaults");
    await verifyContractReady(client);
  }

  const sourceRowCount = providers.length + credentials.length + defaults.length
    + attempts.length + revocationJobs.length;
  const changedRows = plan.providerRowsChanged + plan.credentialRowsChanged
    + defaults.length;
  return {
    contract: PROVIDER_OWNED_CREDENTIALS_CONTRACT,
    mode: apply ? "applied" : "dry-run",
    sourceTableCount: 5,
    sourceRowCount,
    providerRows: providers.length,
    credentialRows: credentials.length,
    defaultRows: defaults.length,
    attemptRows: attempts.length,
    revocationJobRows: revocationJobs.length,
    changedRows,
    providerRowsChanged: plan.providerRowsChanged,
    credentialRowsChanged: plan.credentialRowsChanged,
    defaultRowsChanged: defaults.length,
    providersDirectBound: plan.providersDirectBound,
    providersWithoutCredential: plan.providersWithoutCredential,
    credentialsReowned: plan.credentialRowsChanged,
    defaultsCleared: defaults.length,
    liveCredentialRows: plan.liveCredentialRows,
    disconnectedCredentialRows: plan.disconnectedCredentialRows,
    remainingSharedLiveCredentials: 0,
    remainingOrphanLiveCredentials: 0,
    remainingActiveAttempts: 0,
    remainingNonTerminalRevocationJobs: 0,
    credentialsCloned: 0,
    credentialsDeleted: 0,
    credentialsReencrypted: 0,
    sourceFingerprintSha256: fingerprint.digest("hex"),
    redacted: true,
  };
}

export async function runProviderOwnedCredentialsMigration(
  options: Readonly<{ apply: boolean; databaseUrl?: string }>,
) {
  const databaseUrl = options.databaseUrl ?? targetDatabaseUrl();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let receipt: ProviderOwnedCredentialsReceipt;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [PROVIDER_OWNED_CREDENTIALS_KEY],
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
    ? await recordProviderOwnedCredentialsReceipt(databaseUrl, receipt)
    : null;
  return { ...receipt, registry };
}

export async function runProviderOwnedCredentialsCli(
  arguments_: readonly string[] = process.argv.slice(2),
  options: Readonly<{ databaseUrl?: string }> = {},
) {
  config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
  const allowedArguments = new Set(["--apply", "--preflight"]);
  for (const argument of arguments_) {
    if (!allowedArguments.has(argument)) {
      throw new Error("Usage: provider-owned-credentials-data [--apply|--preflight]");
    }
  }
  if (arguments_.includes("--preflight")) {
    if (arguments_.length !== 1) {
      throw new Error("--preflight cannot be combined with another argument");
    }
    getCredentialEncryptionKey();
    console.log(JSON.stringify({
      contract: PROVIDER_OWNED_CREDENTIALS_CONTRACT,
      status: "ready",
      redacted: true,
    }));
    return;
  }
  const result = await runProviderOwnedCredentialsMigration({
    apply: arguments_.includes("--apply"),
    databaseUrl: options.databaseUrl,
  });
  console.log(JSON.stringify(result));
}

export function reportProviderOwnedCredentialsCliFailure(error?: unknown) {
  if (error instanceof ProviderOwnedCredentialMigrationBlockedError) {
    console.error(JSON.stringify({
      contract: PROVIDER_OWNED_CREDENTIALS_CONTRACT,
      status: "blocked",
      failureCode: error.failureCode,
      conflictCount: error.conflictCount,
      redacted: true,
    }));
    process.exitCode = 1;
    return;
  }
  console.error(JSON.stringify({
    contract: PROVIDER_OWNED_CREDENTIALS_CONTRACT,
    status: "failed",
    redacted: true,
  }));
  process.exitCode = 1;
}
