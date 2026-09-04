// [Input] 0051-expanded Provider tombstones, managed credentials, and authorization attempts.
// [Output] Dry-run or transactional local invalidation of live credentials orphaned by deleted Providers, with an aggregate-only receipt.
// [Pos] Shared provider-deleted-credential-orphans-v1 core; it never calls or records a successful remote revocation.
// [Sync] 2026-09-04: erase local credential/attempt secrets, retain history, and report remote revocation as not_attempted.
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { config } from "dotenv";
import pg, { type PoolClient } from "pg";

import {
  PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT,
  PROVIDER_DELETED_CREDENTIAL_ORPHANS_KEY,
  recordProviderDeletedCredentialOrphansReceipt,
} from "./registry.mjs";

const MANAGED_ADAPTERS = new Set(["codex", "xai", "github_copilot"]);

export type DeletedProviderOrphanProviderRow = Readonly<{
  id: string;
  adapter_kind: string;
  status: string;
  managed_credential_id: string | null;
}>;

export type DeletedProviderOrphanCredentialRow = Readonly<{
  id: string;
  provider_id: string | null;
  adapter_kind: string;
  status: "connected" | "reauth_required" | "disconnected";
  auth_epoch: number;
  revision: number;
  bundle_format_version: number | null;
  bundle_key_id: string | null;
  bundle_ciphertext: string | null;
  bundle_nonce: string | null;
  bundle_tag: string | null;
}>;

export type DeletedProviderOrphanAttemptRow = Readonly<{
  id: string;
  provider_id: string;
  adapter_kind: string;
  target_credential_id: string | null;
  status: "starting" | "pending" | "succeeded" | "denied" | "expired" | "cancelled" | "failed";
  revision: number;
}>;

type ProviderTarget = Readonly<{
  providerId: string;
  credentialId: string;
}>;

type CredentialTarget = Readonly<{
  credentialId: string;
  providerId: string | null;
  adapterKind: string;
  status: "connected" | "reauth_required";
}>;

type AttemptTarget = Readonly<{
  attemptId: string;
  status: "starting" | "pending";
}>;

export type DeletedProviderCredentialOrphanPlan = Readonly<{
  providerTargets: readonly ProviderTarget[];
  credentialTargets: readonly CredentialTarget[];
  attemptTargets: readonly AttemptTarget[];
  providerRowsChanged: number;
  credentialRowsChanged: number;
  attemptRowsChanged: number;
}>;

export type DeletedProviderCredentialOrphanReceipt = Readonly<{
  contract: string;
  mode: "applied" | "dry-run";
  sourceTableCount: 3;
  sourceRowCount: number;
  providerRows: number;
  credentialRows: number;
  attemptRows: number;
  changedRows: number;
  providerRowsChanged: number;
  credentialRowsChanged: number;
  attemptRowsChanged: number;
  providerPointersCleared: number;
  credentialsDisconnected: number;
  credentialSecretsErased: number;
  attemptsCancelled: number;
  remainingDeletedProviderPointers: number;
  remainingDeletedProviderLiveCredentials: number;
  remainingDeletedProviderActiveAttempts: number;
  remoteRevocation: "not_attempted";
  revocationJobsCreated: 0;
  remoteRevocationsSucceeded: 0;
  credentialsDeleted: 0;
  sourceFingerprintSha256: string;
  redacted: true;
}>;

export class DeletedProviderCredentialOrphanMigrationBlockedError extends Error {
  readonly failureCode: string;

  constructor(reason: string) {
    super(`Deleted-Provider credential orphan migration blocked: ${reason}`);
    this.name = "DeletedProviderCredentialOrphanMigrationBlockedError";
    this.failureCode = reason.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  }
}

function failClosed(reason: string): never {
  throw new DeletedProviderCredentialOrphanMigrationBlockedError(reason);
}

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

export function planDeletedProviderCredentialOrphanRepair(input: Readonly<{
  providers: readonly DeletedProviderOrphanProviderRow[];
  credentials: readonly DeletedProviderOrphanCredentialRow[];
  attempts: readonly DeletedProviderOrphanAttemptRow[];
}>): DeletedProviderCredentialOrphanPlan {
  const providersById = new Map<string, DeletedProviderOrphanProviderRow>();
  const deletedProviders = new Map<string, DeletedProviderOrphanProviderRow>();
  const deletedPointerOwners = new Map<string, DeletedProviderOrphanProviderRow[]>();
  for (const provider of input.providers) {
    if (!MANAGED_ADAPTERS.has(provider.adapter_kind)) {
      failClosed("provider inventory contains an unsupported adapter");
    }
    if (providersById.has(provider.id)) {
      failClosed("duplicate Provider identity");
    }
    providersById.set(provider.id, provider);
    if (provider.status !== "deleted") continue;
    deletedProviders.set(provider.id, provider);
    if (provider.managed_credential_id) {
      const owners = deletedPointerOwners.get(provider.managed_credential_id) ?? [];
      owners.push(provider);
      deletedPointerOwners.set(provider.managed_credential_id, owners);
    }
  }

  const credentialTargets: CredentialTarget[] = [];
  const seenCredentialIds = new Set<string>();
  for (const credential of input.credentials) {
    if (seenCredentialIds.has(credential.id)) {
      failClosed("duplicate credential identity");
    }
    seenCredentialIds.add(credential.id);
    if (credential.status !== "connected"
      && credential.status !== "reauth_required") continue;

    const owner = credential.provider_id
      ? providersById.get(credential.provider_id) ?? null
      : null;
    const pointerOwners = deletedPointerOwners.get(credential.id) ?? [];
    if (pointerOwners.length > 1) {
      failClosed("live credential is pointed to by multiple deleted Providers");
    }
    const pointerOwner = pointerOwners[0] ?? null;
    const ownerIsValid = owner !== null
      && owner.adapter_kind === credential.adapter_kind
      && owner.status !== "deleted"
      && owner.managed_credential_id === credential.id;
    if (ownerIsValid && !pointerOwner) continue;
    if (pointerOwner && pointerOwner.adapter_kind !== credential.adapter_kind) {
      failClosed("Provider pointer adapter is mismatched");
    }
    if (owner && pointerOwner && owner.id !== pointerOwner.id) {
      failClosed("credential provenance and Provider pointer disagree");
    }
    credentialTargets.push({
      credentialId: credential.id,
      providerId: credential.provider_id,
      adapterKind: credential.adapter_kind,
      status: credential.status,
    });
  }

  const credentialTargetIds = new Set(
    credentialTargets.map((target) => target.credentialId),
  );
  const providerTargets = input.providers
    .filter((provider): provider is DeletedProviderOrphanProviderRow & {
      managed_credential_id: string;
    } => provider.status === "deleted"
      && provider.managed_credential_id !== null)
    .map((provider) => ({
      providerId: provider.id,
      credentialId: provider.managed_credential_id,
    }));
  const attemptTargets: AttemptTarget[] = [];
  const seenAttemptIds = new Set<string>();
  for (const attempt of input.attempts) {
    if (seenAttemptIds.has(attempt.id)) {
      failClosed("duplicate authorization attempt identity");
    }
    seenAttemptIds.add(attempt.id);
    if (attempt.status !== "starting" && attempt.status !== "pending") continue;
    if (!deletedProviders.has(attempt.provider_id)
      && (!attempt.target_credential_id
        || !credentialTargetIds.has(attempt.target_credential_id))) {
      continue;
    }
    attemptTargets.push({
      attemptId: attempt.id,
      status: attempt.status,
    });
  }

  return {
    providerTargets,
    credentialTargets,
    attemptTargets,
    providerRowsChanged: providerTargets.length,
    credentialRowsChanged: credentialTargets.length,
    attemptRowsChanged: attemptTargets.length,
  };
}

function targetDatabaseUrl() {
  const raw = process.env.MIGRATION_DATABASE_URL;
  if (!raw) throw new Error("MIGRATION_DATABASE_URL is required");
  const parsed = new URL(raw);
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    throw new Error("Deleted-Provider credential orphan migration requires PostgreSQL");
  }
  const localHosts = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const testMarkers = new Set(databaseName.toLowerCase().split(/[^a-z0-9]+/));
  const safeTestName = ["codex", "test", "tests", "tmp", "temp", "ci", "sandbox"]
    .some((marker) => testMarkers.has(marker));
  if (!localHosts.has(parsed.hostname)
    || (databaseName !== "ink-memory" && !safeTestName)) {
    throw new Error("Deleted-Provider credential orphan migration rejected the database safety identity");
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
    [PROVIDER_DELETED_CREDENTIAL_ORPHANS_KEY],
  );
  const row = definition.rows[0];
  if (row?.runner_contract !== PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT
    || row.runner_path !== "drizzle/data/provider-deleted-credential-orphans.ts"
    || Number(row.expected_table_count) !== 3) {
    throw new Error(
      "Apply exact Drizzle migration 0051 before the deleted-Provider credential orphan migration",
    );
  }
}

async function verifyRepair(client: PoolClient) {
  const result = await client.query<{
    deleted_provider_pointers: number;
    deleted_provider_live_credentials: number;
    deleted_provider_active_attempts: number;
  }>(
    `SELECT
       (SELECT count(*)::int
          FROM ai_providers
         WHERE status = 'deleted'
           AND adapter_kind IN ('codex', 'xai', 'github_copilot')
           AND managed_credential_id IS NOT NULL)
         AS deleted_provider_pointers,
       (SELECT count(*)::int
          FROM ai_provider_managed_credentials c
          LEFT JOIN ai_providers p
            ON p.id = c.provider_id
           AND p.adapter_kind = c.adapter_kind
         WHERE c.status IN ('connected', 'reauth_required')
           AND (p.id IS NULL
             OR p.status = 'deleted'
             OR p.managed_credential_id IS DISTINCT FROM c.id))
         AS deleted_provider_live_credentials,
       (SELECT count(*)::int
          FROM ai_provider_auth_attempts a
          JOIN ai_providers p
            ON p.id = a.provider_id
           AND p.adapter_kind = a.adapter_kind
         WHERE p.status = 'deleted'
           AND a.status IN ('starting', 'pending'))
         AS deleted_provider_active_attempts`,
  );
  const row = result.rows[0];
  if (!row || Object.values(row).some((value) => Number(value) !== 0)) {
    throw new Error("Deleted-Provider credential orphan migration verification failed");
  }
}

async function migrate(
  client: PoolClient,
  apply: boolean,
): Promise<DeletedProviderCredentialOrphanReceipt> {
  await assertExpandDefinition(client);
  await client.query(
    `LOCK TABLE ai_providers, ai_provider_managed_credentials,
       ai_provider_auth_attempts IN SHARE ROW EXCLUSIVE MODE`,
  );
  const providers = (await client.query<DeletedProviderOrphanProviderRow>(
    `SELECT id, adapter_kind, status, managed_credential_id
       FROM ai_providers
      WHERE adapter_kind IN ('codex', 'xai', 'github_copilot')
      ORDER BY id
      FOR UPDATE`,
  )).rows;
  const credentials = (await client.query<DeletedProviderOrphanCredentialRow>(
    `SELECT id, provider_id, adapter_kind, status, auth_epoch, revision,
            bundle_format_version, bundle_key_id, bundle_ciphertext,
            bundle_nonce, bundle_tag
       FROM ai_provider_managed_credentials
      WHERE status IN ('connected', 'reauth_required')
      ORDER BY id
      FOR UPDATE`,
  )).rows;
  const attempts = (await client.query<DeletedProviderOrphanAttemptRow>(
    `SELECT id, provider_id, adapter_kind, target_credential_id, status, revision
       FROM ai_provider_auth_attempts
      WHERE status IN ('starting', 'pending')
      ORDER BY id
      FOR UPDATE`,
  )).rows;

  const plan = planDeletedProviderCredentialOrphanRepair({
    providers,
    credentials,
    attempts,
  });
  const fingerprint = createHash("sha256");
  for (const provider of providers) {
    fingerprintEntry(fingerprint, [
      "provider",
      provider.id,
      provider.adapter_kind,
      provider.status,
      provider.managed_credential_id,
    ]);
  }
  for (const credential of credentials) {
    fingerprintEntry(fingerprint, [
      "credential",
      credential.id,
      credential.provider_id,
      credential.adapter_kind,
      credential.status,
      credential.auth_epoch,
      credential.revision,
      credential.bundle_format_version !== null
        || credential.bundle_key_id !== null
        || credential.bundle_ciphertext !== null
        || credential.bundle_nonce !== null
        || credential.bundle_tag !== null,
    ]);
  }
  for (const attempt of attempts) {
    fingerprintEntry(fingerprint, [
      "attempt",
      attempt.id,
      attempt.provider_id,
      attempt.adapter_kind,
      attempt.target_credential_id,
      attempt.status,
      attempt.revision,
    ]);
  }

  if (apply) {
    for (const target of plan.providerTargets) {
      const result = await client.query(
        `UPDATE ai_providers
            SET managed_credential_id = NULL,
                active_credential_kind = 'none',
                auth_epoch = auth_epoch + 1,
                updated_at = NOW()
          WHERE id = $1
            AND status = 'deleted'
            AND managed_credential_id = $2`,
        [target.providerId, target.credentialId],
      );
      if (result.rowCount !== 1) failClosed("Provider pointer changed during repair");
    }
    for (const target of plan.attemptTargets) {
      const result = await client.query(
        `UPDATE ai_provider_auth_attempts
            SET status = 'cancelled', revision = revision + 1,
                state_hash = NULL,
                bundle_format_version = NULL, bundle_key_id = NULL,
                bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
                redirect_uri = NULL, verification_uri = NULL, expires_at = NULL,
                poll_interval_seconds = NULL, next_poll_at = NULL,
                operation_lease_id = NULL, operation_lease_expires_at = NULL,
                failure_code = 'PROVIDER_DELETED', consumed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1 AND status = $2`,
        [target.attemptId, target.status],
      );
      if (result.rowCount !== 1) failClosed("authorization attempt changed during repair");
    }
    for (const target of plan.credentialTargets) {
      const result = await client.query(
        `UPDATE ai_provider_managed_credentials
            SET provider_id = NULL, status = 'disconnected',
                auth_epoch = auth_epoch + 1, revision = revision + 1,
                bundle_format_version = NULL, bundle_key_id = NULL,
                bundle_ciphertext = NULL, bundle_nonce = NULL, bundle_tag = NULL,
                granted_scopes = ARRAY[]::text[], access_expires_at = NULL,
                refresh_expires_at = NULL, session_expires_at = NULL,
                refresh_lease_id = NULL, refresh_lease_expires_at = NULL,
                revocation_status = 'not_attempted',
                revocation_attempted_at = NULL, revocation_completed_at = NULL,
                revocation_failure_code = NULL, disconnected_at = NOW(),
                updated_at = NOW()
          WHERE id = $1
            AND adapter_kind = $2
            AND status = $3
            AND provider_id IS NOT DISTINCT FROM $4`,
        [
          target.credentialId,
          target.adapterKind,
          target.status,
          target.providerId,
        ],
      );
      if (result.rowCount !== 1) failClosed("managed credential changed during repair");
    }
    await verifyRepair(client);
  }

  const sourceRowCount = providers.length + credentials.length + attempts.length;
  const changedRows = plan.providerRowsChanged + plan.credentialRowsChanged
    + plan.attemptRowsChanged;
  const credentialTargetIds = new Set(
    plan.credentialTargets.map((target) => target.credentialId),
  );
  const credentialSecretsErased = credentials.filter((credential) => (
    credentialTargetIds.has(credential.id)
    && (
      credential.bundle_format_version !== null
      || credential.bundle_key_id !== null
      || credential.bundle_ciphertext !== null
      || credential.bundle_nonce !== null
      || credential.bundle_tag !== null
    )
  )).length;
  return {
    contract: PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT,
    mode: apply ? "applied" : "dry-run",
    sourceTableCount: 3,
    sourceRowCount,
    providerRows: providers.length,
    credentialRows: credentials.length,
    attemptRows: attempts.length,
    changedRows,
    providerRowsChanged: plan.providerRowsChanged,
    credentialRowsChanged: plan.credentialRowsChanged,
    attemptRowsChanged: plan.attemptRowsChanged,
    providerPointersCleared: plan.providerRowsChanged,
    credentialsDisconnected: plan.credentialRowsChanged,
    credentialSecretsErased,
    attemptsCancelled: plan.attemptRowsChanged,
    remainingDeletedProviderPointers: apply ? 0 : plan.providerRowsChanged,
    remainingDeletedProviderLiveCredentials: apply ? 0 : plan.credentialRowsChanged,
    remainingDeletedProviderActiveAttempts: apply ? 0 : plan.attemptRowsChanged,
    remoteRevocation: "not_attempted",
    revocationJobsCreated: 0,
    remoteRevocationsSucceeded: 0,
    credentialsDeleted: 0,
    sourceFingerprintSha256: fingerprint.digest("hex"),
    redacted: true,
  };
}

export async function runDeletedProviderCredentialOrphanMigration(
  options: Readonly<{ apply: boolean; databaseUrl?: string }>,
) {
  const databaseUrl = options.databaseUrl ?? targetDatabaseUrl();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  let receipt: DeletedProviderCredentialOrphanReceipt;
  try {
    await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [PROVIDER_DELETED_CREDENTIAL_ORPHANS_KEY],
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
    ? await recordProviderDeletedCredentialOrphansReceipt(databaseUrl, receipt)
    : null;
  return { ...receipt, registry };
}

export async function runDeletedProviderCredentialOrphanCli(
  arguments_: readonly string[] = process.argv.slice(2),
  options: Readonly<{ databaseUrl?: string }> = {},
) {
  config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
  const allowedArguments = new Set(["--apply", "--preflight"]);
  for (const argument of arguments_) {
    if (!allowedArguments.has(argument)) {
      throw new Error(
        "Usage: provider-deleted-credential-orphans-data [--apply|--preflight]",
      );
    }
  }
  if (arguments_.includes("--preflight")) {
    if (arguments_.length !== 1) {
      throw new Error("--preflight cannot be combined with another argument");
    }
    console.log(JSON.stringify({
      contract: PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT,
      status: "ready",
      remoteRevocation: "not_attempted",
      redacted: true,
    }));
    return;
  }
  const result = await runDeletedProviderCredentialOrphanMigration({
    apply: arguments_.includes("--apply"),
    databaseUrl: options.databaseUrl,
  });
  console.log(JSON.stringify(result));
}

export function reportDeletedProviderCredentialOrphanCliFailure(error?: unknown) {
  if (error instanceof DeletedProviderCredentialOrphanMigrationBlockedError) {
    console.error(JSON.stringify({
      contract: PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT,
      status: "blocked",
      failureCode: error.failureCode,
      remoteRevocation: "not_attempted",
      redacted: true,
    }));
    process.exitCode = 1;
    return;
  }
  console.error(JSON.stringify({
    contract: PROVIDER_DELETED_CREDENTIAL_ORPHANS_CONTRACT,
    status: "failed",
    remoteRevocation: "not_attempted",
    redacted: true,
  }));
  process.exitCode = 1;
}
