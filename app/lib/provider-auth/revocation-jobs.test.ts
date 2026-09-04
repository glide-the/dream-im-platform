// [Input] Product-specific revoke material, deterministic encrypted job rows, fake PostgreSQL CAS, and fake adapters.
// [Output] Regression proof for encrypted enqueue, lease claims, terminal erasure, retry retention, and secret-safe projection.
// [Pos] Unit contract for the durable Provider revocation outbox lifecycle.
// [Sync] 2026-09-04: cover account-scoped enqueue/locking, success, failure retention, registration fencing, and audit deduplication.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { providerRevocationMaterialSchema } from "../providers/schemas";
import type {
  ProviderProductRegistry,
  ProviderRevocationMaterial,
} from "../providers/types";
import { encryptCredentialEnvelope } from "../security/credential-envelope";
import {
  enqueueProviderRevocationJobOnClient,
  processProviderRevocationJob,
  revocationJobProjection,
  type ProviderRevocationJobRow,
} from "./revocation-jobs";

const material: ProviderRevocationMaterial = {
  product: "xai",
  refreshToken: "refresh-secret-never-project",
};

function jobRow(overrides: Partial<ProviderRevocationJobRow> = {}): ProviderRevocationJobRow {
  const envelope = encryptCredentialEnvelope(
    material,
    {
      providerId: "provider-1",
      adapterKind: "xai",
      recordKind: "revocation_job",
      recordId: "revocationjob-1",
      revision: 4,
    },
    providerRevocationMaterialSchema,
  );
  return {
    id: "revocationjob-1",
    provider_id: "provider-1",
    adapter_kind: "xai",
    managed_credential_id: "managedcred-1",
    account_scope_id: "managedcred-1",
    credential_auth_epoch: 7,
    envelope_context_id: "provider-1",
    source_kind: "credential",
    source_record_id: "managedcred-1",
    source_record_revision: 4,
    source_auth_epoch: 7,
    reason: "renewal_rejected",
    status: "pending",
    revision: 1,
    attempt_count: 0,
    next_attempt_at: "2026-09-04T10:00:00.000Z",
    operation_lease_id: null,
    operation_lease_expires_at: null,
    bundle_format_version: envelope.formatVersion,
    bundle_key_id: envelope.keyId,
    bundle_ciphertext: envelope.ciphertext,
    bundle_nonce: envelope.nonce,
    bundle_tag: envelope.tag,
    registration_fingerprint: "registration-1",
    failure_code: null,
    completed_at: null,
    created_at: "2026-09-04T10:00:00.000Z",
    updated_at: "2026-09-04T10:00:00.000Z",
    ...overrides,
  };
}

function registry(revoke: ReturnType<typeof vi.fn>, fingerprint = "registration-1") {
  return {
    readiness: () => ({
      status: "ready",
      product: "xai",
      registrationFingerprint: fingerprint,
      oauthAppConfigured: true,
      integrationProfileConfigured: null,
      copilotAccessVerified: null,
      capabilities: {
        deviceAuthorization: true,
        refreshOrRenew: true,
        remoteRevoke: true,
        modelResource: true,
      },
    }),
    get: () => ({ revoke }),
  } as unknown as ProviderProductRegistry;
}

function processingHarness(initial = jobRow()) {
  let row = initial;
  const queries: string[] = [];
  const withTransaction = (async (
    handler: (client: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) => Promise<unknown>,
  ) => await handler({
    query: async (sql: string, values: unknown[] = []) => {
      queries.push(sql);
      if (sql.startsWith("SELECT adapter_kind, account_scope_id")) {
        return {
          rows: [{
            adapter_kind: row.adapter_kind,
            account_scope_id: row.account_scope_id,
          }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("SELECT * FROM ai_provider_revocation_jobs")) {
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes("UPDATE ai_provider_revocation_jobs AS job")) {
        row = {
          ...row,
          status: "processing",
          revision: row.revision + 1,
          attempt_count: row.attempt_count + 1,
          next_attempt_at: null,
          operation_lease_id: String(values[2]),
          operation_lease_expires_at: "2026-09-04T10:01:30.000Z",
          failure_code: null,
        };
        return { rows: [row], rowCount: 1 };
      }
      if (sql.includes("UPDATE ai_provider_revocation_jobs\n")) {
        const terminal = Boolean(values[4]);
        row = {
          ...row,
          status: values[3] as ProviderRevocationJobRow["status"],
          revision: row.revision + 1,
          next_attempt_at: terminal ? null : "2026-09-04T10:00:10.000Z",
          operation_lease_id: null,
          operation_lease_expires_at: null,
          bundle_format_version: terminal ? null : row.bundle_format_version,
          bundle_key_id: terminal ? null : row.bundle_key_id,
          bundle_ciphertext: terminal ? null : row.bundle_ciphertext,
          bundle_nonce: terminal ? null : row.bundle_nonce,
          bundle_tag: terminal ? null : row.bundle_tag,
          failure_code: values[5] as string | null,
          completed_at: terminal ? "2026-09-04T10:00:02.000Z" : null,
        };
        return { rows: [row], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  })) as never;
  return { withTransaction, queries, current: () => row };
}

beforeEach(() => {
  process.env.AI_CREDENTIAL_ENCRYPTION_KEY = "33".repeat(32);
});

afterEach(() => {
  delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
});

describe("Provider revocation jobs", () => {
  it("encrypts newly enqueued material and projects no secret", async () => {
    let insertedSql = "";
    let insertedValues: unknown[] = [];
    const client = {
      query: vi.fn(async (sql: string, values: unknown[]) => {
        insertedSql = sql;
        insertedValues = values;
        return { rows: [jobRow({
          id: String(values[0]),
          bundle_ciphertext: String(values[14]),
        })], rowCount: 1 };
      }),
    };
    const row = await enqueueProviderRevocationJobOnClient(client as never, {
      providerId: "provider-1",
      adapterKind: "xai",
      sourceKind: "credential",
      sourceRecordId: "managedcred-1",
      sourceRecordRevision: 4,
      sourceAuthEpoch: 7,
      accountScopeId: "managedcred-1",
      managedCredentialId: "managedcred-1",
      credentialAuthEpoch: 7,
      envelopeContextId: "managedcred-1",
      reason: "renewal_rejected",
      registrationFingerprint: "registration-1",
      material,
    }, { createId: () => "revocationjob-1" });

    expect(String(insertedValues)).not.toContain(material.refreshToken);
    expect(insertedValues.slice(3, 7)).toEqual([
      "managedcred-1",
      "managedcred-1",
      7,
      "managedcred-1",
    ]);
    expect(insertedSql).toContain(
      "ON CONFLICT (adapter_kind, account_scope_id, source_kind, source_record_id, source_record_revision, reason)",
    );
    expect(JSON.stringify(revocationJobProjection(row))).not.toContain(material.refreshToken);
  });

  it("projects only the non-secret lease expiry needed to reclaim crashed processing work", () => {
    expect(revocationJobProjection(jobRow({
      status: "processing",
      operation_lease_id: "secret-internal-lease-id",
      operation_lease_expires_at: "2026-09-04T10:01:30.000Z",
    }))).toMatchObject({
      status: "processing",
      operationLeaseExpiresAt: "2026-09-04T10:01:30.000Z",
    });
    expect(JSON.stringify(revocationJobProjection(jobRow({
      status: "processing",
      operation_lease_id: "secret-internal-lease-id",
    })))).not.toContain("secret-internal-lease-id");
  });

  it("claims with a DB-clock lease, revokes, audits, and erases the envelope", async () => {
    const revoke = vi.fn().mockResolvedValue({ status: "revoked", product: "xai", remote: true });
    const harness = processingHarness();
    const result = await processProviderRevocationJob("revocationjob-1", {
      registry: registry(revoke),
      withTransaction: harness.withTransaction,
      createLeaseId: () => "lease-1",
      force: true,
    });

    expect(revoke).toHaveBeenCalledWith(material);
    expect(result).toMatchObject({ status: "succeeded", attempt_count: 1 });
    expect(result?.bundle_ciphertext).toBeNull();
    expect(harness.queries.some((sql) =>
      sql.includes("SELECT adapter_kind, account_scope_id FROM ai_provider_revocation_jobs")
    )).toBe(true);
    expect(harness.queries.some((sql) => sql.includes("operation_lease_expires_at = NOW()"))).toBe(true);
    const auditSql = harness.queries.find((sql) => sql.includes("INSERT INTO admin_audit_logs"));
    expect(auditSql).toContain(
      "ON CONFLICT (request_id, action, resource_type, resource_id) DO NOTHING",
    );
  });

  it("retains encrypted material and schedules retry after a sanitized remote failure", async () => {
    const revoke = vi.fn().mockResolvedValue({
      status: "failed",
      product: "xai",
      error: {
        code: "XAI_REVOKE_FAILED",
        category: "network",
        message: "safe",
        retryable: true,
      },
    });
    const harness = processingHarness();
    const result = await processProviderRevocationJob("revocationjob-1", {
      registry: registry(revoke),
      withTransaction: harness.withTransaction,
      createLeaseId: () => "lease-2",
      force: true,
    });

    expect(result).toMatchObject({
      status: "failed",
      failure_code: "XAI_REVOKE_FAILED",
      next_attempt_at: expect.any(String),
    });
    expect(result?.bundle_ciphertext).toEqual(expect.any(String));
    expect(JSON.stringify(revocationJobProjection(result))).not.toContain(material.refreshToken);
  });

  it("marks a registration-mismatched job unsupported without sending its secret", async () => {
    const revoke = vi.fn();
    const harness = processingHarness();
    const result = await processProviderRevocationJob("revocationjob-1", {
      registry: registry(revoke, "registration-2"),
      withTransaction: harness.withTransaction,
      createLeaseId: () => "lease-3",
      force: true,
    });

    expect(revoke).not.toHaveBeenCalled();
    expect(result?.status).toBe("unsupported");
    expect(result?.bundle_ciphertext).toBeNull();
  });
});
