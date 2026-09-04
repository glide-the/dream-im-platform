// [Input] Product-specific revocation material, a source revision/epoch, PostgreSQL, and the Provider registry.
// [Output] Durable encrypted revocation jobs plus lease/CAS-protected remote revoke outcomes and secret-free projections.
// [Pos] Shared Provider auth lifecycle domain used by Admin disconnect/activation and Gateway renewal rejection paths.
// [Sync] 2026-09-04: add the minimal encrypted revocation outbox without creating a generic job framework.

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { withPlatformTransaction } from "../platform-db";
import { createPlatformId } from "../platform-ids";
import { getProviderProductRegistry } from "../providers";
import { providerRevocationMaterialSchema } from "../providers/schemas";
import type {
  ProviderProductRegistry,
  ProviderRevocationMaterial,
} from "../providers/types";
import {
  decryptCredentialEnvelope,
  encryptCredentialEnvelope,
  type EncryptedCredentialEnvelope,
} from "../security/credential-envelope";

export type RevocationJobReason =
  | "disconnect"
  | "replacement"
  | "activation_rejected"
  | "renewal_rejected";
export type RevocationJobSourceKind = "credential" | "attempt";
export type RevocationJobStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "unsupported";

export type ProviderRevocationJobRow = {
  id: string;
  provider_id: string;
  adapter_kind: ProviderRevocationMaterial["product"];
  managed_credential_id: string | null;
  account_scope_id: string;
  credential_auth_epoch: number | null;
  envelope_context_id: string;
  source_kind: RevocationJobSourceKind;
  source_record_id: string;
  source_record_revision: number;
  source_auth_epoch: number;
  reason: RevocationJobReason;
  status: RevocationJobStatus;
  revision: number;
  attempt_count: number;
  next_attempt_at: Date | string | null;
  operation_lease_id: string | null;
  operation_lease_expires_at: Date | string | null;
  bundle_format_version: number | null;
  bundle_key_id: string | null;
  bundle_ciphertext: string | null;
  bundle_nonce: string | null;
  bundle_tag: string | null;
  registration_fingerprint: string;
  failure_code: string | null;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type RevocationJobDependencies = Readonly<{
  registry?: ProviderProductRegistry;
  withTransaction?: typeof withPlatformTransaction;
  createId?: (prefix: string) => string;
  createLeaseId?: () => string;
}>;

const REVOCATION_LEASE_MILLISECONDS = 90_000;

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function envelopeFromRow(row: ProviderRevocationJobRow): EncryptedCredentialEnvelope {
  if (
    row.bundle_format_version !== 1 ||
    !row.bundle_key_id ||
    !row.bundle_ciphertext ||
    !row.bundle_nonce ||
    !row.bundle_tag
  ) {
    throw new Error("REVOCATION_JOB_BUNDLE_UNAVAILABLE");
  }
  return {
    formatVersion: 1,
    keyId: row.bundle_key_id,
    ciphertext: row.bundle_ciphertext,
    nonce: row.bundle_nonce,
    tag: row.bundle_tag,
  };
}

function envelopeContext(row: Pick<ProviderRevocationJobRow,
  "envelope_context_id" | "adapter_kind" | "id" | "source_record_revision">) {
  return {
    providerId: row.envelope_context_id,
    adapterKind: row.adapter_kind,
    recordKind: "revocation_job" as const,
    recordId: row.id,
    // Job revision is mutable CAS state; the immutable source revision binds the payload AAD.
    revision: row.source_record_revision,
  };
}

function safeFailureCode(value: unknown, fallback: string) {
  return typeof value === "string" && /^[A-Z0-9_]{2,120}$/.test(value)
    ? value
    : fallback;
}

export function revocationJobProjection(row: ProviderRevocationJobRow | null) {
  if (!row) return null;
  return {
    id: row.id,
    accountId: row.managed_credential_id,
    managedCredentialId: row.managed_credential_id,
    status: row.status,
    revision: row.revision,
    reason: row.reason,
    attemptCount: row.attempt_count,
    nextAttemptAt: iso(row.next_attempt_at),
    operationLeaseExpiresAt: iso(row.operation_lease_expires_at),
    failureCode: row.failure_code,
    completedAt: iso(row.completed_at),
    updatedAt: iso(row.updated_at),
  };
}

export async function loadLatestProviderRevocationJobOnClient(
  client: PoolClient,
  providerId: string,
) {
  const result = await client.query<ProviderRevocationJobRow>(
    `SELECT * FROM ai_provider_revocation_jobs
      WHERE provider_id = $1
      ORDER BY (status IN ('pending', 'processing', 'failed')) DESC,
               created_at DESC, id DESC
      LIMIT 1`,
    [providerId],
  );
  return result.rows[0] ?? null;
}

export async function enqueueProviderRevocationJobOnClient(
  client: PoolClient,
  input: Readonly<{
    providerId: string;
    adapterKind: ProviderRevocationMaterial["product"];
    sourceKind: RevocationJobSourceKind;
    sourceRecordId: string;
    sourceRecordRevision: number;
    sourceAuthEpoch: number;
    accountScopeId?: string;
    managedCredentialId?: string;
    credentialAuthEpoch?: number;
    envelopeContextId?: string;
    reason: RevocationJobReason;
    registrationFingerprint: string;
    material: ProviderRevocationMaterial;
  }>,
  dependencies: Pick<RevocationJobDependencies, "createId"> = {},
) {
  if (input.material.product !== input.adapterKind) {
    throw new Error("REVOCATION_JOB_PRODUCT_MISMATCH");
  }
  const id = (dependencies.createId ?? createPlatformId)("revocationjob");
  const accountScopeId = input.accountScopeId
    ?? input.managedCredentialId
    ?? input.sourceRecordId;
  const envelopeContextId = input.envelopeContextId ?? accountScopeId;
  const envelope = encryptCredentialEnvelope(
    input.material,
    {
      providerId: envelopeContextId,
      adapterKind: input.adapterKind,
      recordKind: "revocation_job",
      recordId: id,
      revision: input.sourceRecordRevision,
    },
    providerRevocationMaterialSchema,
  );
  const inserted = await client.query<ProviderRevocationJobRow>(
    `INSERT INTO ai_provider_revocation_jobs (
       id, provider_id, adapter_kind, managed_credential_id,
       account_scope_id, credential_auth_epoch, envelope_context_id,
       source_kind, source_record_id,
       source_record_revision, source_auth_epoch, reason, status, revision,
       attempt_count, next_attempt_at,
       bundle_format_version, bundle_key_id, bundle_ciphertext, bundle_nonce, bundle_tag,
       registration_fingerprint
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       'pending', 1, 0, NOW(), $13, $14, $15, $16, $17, $18
     )
     ON CONFLICT (adapter_kind, account_scope_id, source_kind, source_record_id, source_record_revision, reason)
     DO NOTHING
     RETURNING *`,
    [
      id,
      input.providerId,
      input.adapterKind,
      input.managedCredentialId ?? null,
      accountScopeId,
      input.credentialAuthEpoch ?? null,
      envelopeContextId,
      input.sourceKind,
      input.sourceRecordId,
      input.sourceRecordRevision,
      input.sourceAuthEpoch,
      input.reason,
      envelope.formatVersion,
      envelope.keyId,
      envelope.ciphertext,
      envelope.nonce,
      envelope.tag,
      input.registrationFingerprint,
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0];
  const existing = await client.query<ProviderRevocationJobRow>(
    `SELECT * FROM ai_provider_revocation_jobs
      WHERE adapter_kind = $1 AND account_scope_id = $2
        AND source_kind = $3 AND source_record_id = $4
        AND source_record_revision = $5 AND reason = $6`,
    [
      input.adapterKind,
      accountScopeId,
      input.sourceKind,
      input.sourceRecordId,
      input.sourceRecordRevision,
      input.reason,
    ],
  );
  if (!existing.rows[0]) throw new Error("REVOCATION_JOB_ENQUEUE_CONFLICT");
  return existing.rows[0];
}

async function claimJob(
  client: PoolClient,
  jobId: string,
  leaseId: string,
  force: boolean,
  expectedRevision?: number,
) {
  const discovered = await client.query<{ adapter_kind: string; account_scope_id: string }>(
    "SELECT adapter_kind, account_scope_id FROM ai_provider_revocation_jobs WHERE id = $1",
    [jobId],
  );
  if (!discovered.rows[0]) return null;
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `provider-managed-revocation:${discovered.rows[0].adapter_kind}:${discovered.rows[0].account_scope_id}`,
  ]);
  const current = await client.query<ProviderRevocationJobRow>(
    "SELECT * FROM ai_provider_revocation_jobs WHERE id = $1 FOR UPDATE",
    [jobId],
  );
  const row = current.rows[0];
  if (!row || row.status === "succeeded" || row.status === "unsupported") return null;
  if (expectedRevision !== undefined && row.revision !== expectedRevision) return null;
  const claimed = await client.query<ProviderRevocationJobRow>(
    `UPDATE ai_provider_revocation_jobs AS job
        SET status = 'processing', revision = revision + 1,
            attempt_count = attempt_count + 1, next_attempt_at = NULL,
            operation_lease_id = $3,
            operation_lease_expires_at = NOW() + ($4 * interval '1 millisecond'),
            failure_code = NULL, updated_at = NOW()
      WHERE job.id = $1 AND job.revision = $2
        AND (
          (job.status IN ('pending', 'failed') AND ($5 OR job.next_attempt_at <= NOW()))
          OR (job.status = 'processing' AND job.operation_lease_expires_at <= NOW())
        )
        AND NOT EXISTS (
          SELECT 1 FROM ai_provider_revocation_jobs AS active
           WHERE active.adapter_kind = job.adapter_kind
             AND active.account_scope_id = job.account_scope_id
             AND active.status = 'processing' AND active.id <> job.id
        )
      RETURNING job.*`,
    [row.id, row.revision, leaseId, REVOCATION_LEASE_MILLISECONDS, force],
  );
  return claimed.rows[0] ?? null;
}

async function finishJob(
  client: PoolClient,
  claimed: ProviderRevocationJobRow,
  leaseId: string,
  outcome: Readonly<{
    status: "succeeded" | "unsupported" | "failed";
    failureCode?: string;
  }>,
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
    `provider-managed-revocation:${claimed.adapter_kind}:${claimed.account_scope_id}`,
  ]);
  const terminal = outcome.status !== "failed";
  const result = await client.query<ProviderRevocationJobRow>(
    `UPDATE ai_provider_revocation_jobs
        SET status = $4, revision = revision + 1,
            next_attempt_at = CASE
              WHEN $4 = 'failed' THEN NOW() + (
                LEAST(3600, 5 * power(2, LEAST(attempt_count, 9))) * interval '1 second'
              )
              ELSE NULL
            END,
            operation_lease_id = NULL, operation_lease_expires_at = NULL,
            bundle_format_version = CASE WHEN $5 THEN NULL ELSE bundle_format_version END,
            bundle_key_id = CASE WHEN $5 THEN NULL ELSE bundle_key_id END,
            bundle_ciphertext = CASE WHEN $5 THEN NULL ELSE bundle_ciphertext END,
            bundle_nonce = CASE WHEN $5 THEN NULL ELSE bundle_nonce END,
            bundle_tag = CASE WHEN $5 THEN NULL ELSE bundle_tag END,
            failure_code = $6,
            completed_at = CASE WHEN $5 THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE id = $1 AND revision = $2 AND operation_lease_id = $3
        AND status = 'processing'
      RETURNING *`,
    [
      claimed.id,
      claimed.revision,
      leaseId,
      outcome.status,
      terminal,
      outcome.status === "failed"
        ? safeFailureCode(outcome.failureCode, "REMOTE_REVOKE_FAILED")
        : null,
    ],
  );
  const finished = result.rows[0];
  if (!finished) return null;
  if (finished.source_kind === "credential" && finished.reason === "disconnect") {
    await client.query(
      `UPDATE ai_provider_managed_credentials
          SET revocation_status = $3,
              revocation_attempted_at = CASE WHEN $3 IN ('succeeded', 'failed') THEN NOW() ELSE NULL END,
              revocation_completed_at = CASE WHEN $3 = 'succeeded' THEN NOW() ELSE NULL END,
              revocation_failure_code = CASE WHEN $3 = 'failed' THEN $4 ELSE NULL END,
              updated_at = NOW()
        WHERE id = $1 AND revision = $2 AND status = 'disconnected'`,
      [
        finished.source_record_id,
        finished.source_record_revision + 1,
        finished.status,
        finished.failure_code,
      ],
    );
  }
  await client.query(
    `INSERT INTO admin_audit_logs (
       id, actor_type, actor_id, action, resource_type, resource_id,
       request_id, ip_address, user_agent, before, after, metadata
     ) VALUES (
       $1, 'system', NULL, 'provider_remote_revocation_finished',
       'provider_revocation_job', $2, $3, NULL, NULL, NULL,
       $4::jsonb, $5::jsonb
     )
     ON CONFLICT (request_id, action, resource_type, resource_id) DO NOTHING`,
    [
      createPlatformId("audit"),
      finished.id,
      `revocation:${finished.id}:${finished.revision}`,
      JSON.stringify({ status: claimed.status, revision: claimed.revision }),
      JSON.stringify({
        providerId: finished.provider_id,
        adapterKind: finished.adapter_kind,
        reason: finished.reason,
        status: finished.status,
        failureCode: finished.failure_code,
        attemptCount: finished.attempt_count,
      }),
    ],
  );
  return finished;
}

export async function processProviderRevocationJob(
  jobId: string,
  inputDependencies: RevocationJobDependencies & Readonly<{
    force?: boolean;
    expectedRevision?: number;
  }> = {},
) {
  const withTransaction = inputDependencies.withTransaction ?? withPlatformTransaction;
  const registry = inputDependencies.registry ?? getProviderProductRegistry();
  const leaseId = (inputDependencies.createLeaseId ?? randomUUID)();
  const claimed = await withTransaction((client) => claimJob(
    client,
    jobId,
    leaseId,
    inputDependencies.force ?? false,
    inputDependencies.expectedRevision,
  ));
  if (!claimed) return null;

  let outcome: { status: "succeeded" | "unsupported" | "failed"; failureCode?: string };
  try {
    const readiness = registry.readiness(claimed.adapter_kind);
    if (readiness.status !== "ready") {
      outcome = {
        status: "failed",
        failureCode: "REVOCATION_DEPLOYMENT_UNAVAILABLE",
      };
    } else if (readiness.registrationFingerprint !== claimed.registration_fingerprint) {
      outcome = { status: "unsupported" };
    } else {
      const material = decryptCredentialEnvelope(
        envelopeFromRow(claimed),
        envelopeContext(claimed),
        providerRevocationMaterialSchema,
      );
      const revoked = await registry.get(claimed.adapter_kind).revoke(material);
      outcome = revoked.status === "revoked"
        ? { status: "succeeded" }
        : revoked.status === "unsupported"
          ? { status: "unsupported" }
          : {
              status: "failed",
              failureCode: safeFailureCode(revoked.error.code, "REMOTE_REVOKE_FAILED"),
            };
    }
  } catch (error) {
    outcome = {
      status: "failed",
      failureCode: safeFailureCode(
        error && typeof error === "object" && "code" in error ? error.code : null,
        "REVOCATION_JOB_FAILED",
      ),
    };
  }
  return await withTransaction((client) => finishJob(client, claimed, leaseId, outcome));
}
