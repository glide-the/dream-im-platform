// [Input] Managed-auth handlers with injected registry/database seams and encrypted Device state.
// [Output] Regression proof for one Provider-owned credential, fencing, retry scheduling, and safe projections.
// [Pos] Focused Admin orchestration tests; no real Provider or PostgreSQL connection is used.
// [Sync] 2026-09-04: cover direct Provider ownership and failure-isolated post-connect model discovery.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { encryptCredentialEnvelope } from "../security/credential-envelope";
import { deviceFlowStateSchema, providerTokenBundleSchema } from "../providers/schemas";
import {
  createProviderRevocationHandoff,
  type DeviceFlowState,
  type ProviderProductRegistry,
} from "../providers/types";

const mocks = vi.hoisted(() => ({
  requireAdminRequest: vi.fn(),
  assertAdminMutationOrigin: vi.fn(),
  audit: vi.fn(),
  enqueueRevocation: vi.fn().mockResolvedValue({ id: "revocationjob-admin" }),
  processRevocation: vi.fn().mockResolvedValue({ status: "succeeded" }),
  loadLatestRevocation: vi.fn().mockResolvedValue(null),
}));

vi.mock("../provider-auth/revocation-jobs", () => ({
  enqueueProviderRevocationJobOnClient: mocks.enqueueRevocation,
  processProviderRevocationJob: mocks.processRevocation,
  loadLatestProviderRevocationJobOnClient: mocks.loadLatestRevocation,
  revocationJobProjection: (row: unknown) => row,
}));

vi.mock("./guard", () => ({
  adminRequestId: () => "admin_managed_auth_test",
  requireAdminRequest: mocks.requireAdminRequest,
  assertAdminMutationOrigin: mocks.assertAdminMutationOrigin,
}));

vi.mock("./audit", () => ({
  recordAdminAuditOnClient: mocks.audit,
}));

import {
  handleProviderManagedAuthDisconnect,
  handleProviderManagedAuthDisconnectAccount,
  handleProviderManagedAuthPoll,
  handleProviderManagedAuthRevocationRetry,
  handleProviderManagedAuthSetBinding,
  handleProviderManagedAuthSetDefault,
  handleProviderManagedAuthStart,
  handleProviderManagedAuthStatus,
  providerManagedAuthTestExports,
} from "./provider-managed-auth";

const identity = {
  id: "admin_1",
  email: "admin@example.test",
  roles: ["operator"],
  permissions: ["providers.read", "providers.write"],
  sessionId: "session_1",
};

const provider = {
  id: "provider_1",
  code: "codex-main",
  name: "Codex",
  status: "disabled" as const,
  adapter_kind: "codex" as const,
  active_credential_kind: "managed_oauth" as const,
  auth_epoch: 4,
  managed_credential_id: null,
};

const registry = {
  readiness: (_product: "codex" | "xai" | "github_copilot") => ({
    status: "ready" as const,
    product: "codex" as const,
    registrationFingerprint: "registration-v1",
    oauthAppConfigured: true as const,
    integrationProfileConfigured: null,
    copilotAccessVerified: null,
    capabilities: {
      deviceAuthorization: true as const,
      refreshOrRenew: true as const,
      remoteRevoke: true,
      modelResource: true as const,
    },
  }),
  get: () => ({
    product: "codex" as const,
    readiness: () => registry.readiness("codex"),
    startDevice: vi.fn(),
    pollDevice: vi.fn(),
    refreshOrRenew: vi.fn(),
    revoke: vi.fn(),
    fetchModelCatalog: vi.fn(),
    getResourceContract: vi.fn(),
  }),
  allReadiness: () => [registry.readiness("codex")],
} satisfies ProviderProductRegistry;

function connectedCredential(overrides: Record<string, unknown> = {}) {
  const credentialId = typeof overrides.id === "string" ? overrides.id : "managed_1";
  const revision = typeof overrides.revision === "number" ? overrides.revision : 2;
  const envelope = encryptCredentialEnvelope(
    {
      product: "codex" as const,
      accessToken: "access-secret-never-return",
      refreshToken: "refresh-secret-never-return",
      expiresAtMs: Date.parse("2026-09-04T11:00:00.000Z"),
      grantedScopes: ["openid", "offline_access"],
      identity: { subject: "subject-1", chatgptAccountId: "account-1" },
    },
    {
      providerId: credentialId,
      adapterKind: "codex",
      recordKind: "credential",
      recordId: credentialId,
      revision,
    },
    providerTokenBundleSchema,
  );
  return {
    id: credentialId,
    provider_id: provider.id,
    adapter_kind: "codex",
    status: "connected",
    auth_epoch: 2,
    revision,
    display_name: "Codex account",
    envelope_context_id: credentialId,
    bundle_format_version: envelope.formatVersion,
    bundle_key_id: envelope.keyId,
    bundle_ciphertext: envelope.ciphertext,
    bundle_nonce: envelope.nonce,
    bundle_tag: envelope.tag,
    registration_fingerprint: "registration-v1",
    account_identity_hash: "identity-hash",
    account_label: null,
    granted_scopes: ["openid", "offline_access"],
    access_expires_at: "2026-09-04T11:00:00.000Z",
    refresh_expires_at: null,
    session_expires_at: null,
    revocation_status: null,
    disconnected_at: null,
    created_at: "2026-09-04T09:00:00.000Z",
    updated_at: "2026-09-04T09:30:00.000Z",
    ...overrides,
  };
}

function request(path: string, body?: Record<string, unknown>) {
  return new Request(`https://admin.test${path}`, body
    ? {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://admin.test" },
        body: JSON.stringify(body),
      }
    : undefined);
}

function dependencies(
  query: ReturnType<typeof vi.fn>,
  productRegistry = registry,
  discoverModels = vi.fn().mockResolvedValue({
    id: "discovery_after_connect",
    discoveredCount: 2,
    newCount: 2,
    conflictCount: 0,
    unsupportedCount: 0,
    reused: false,
  }),
) {
  const client = { query };
  return {
    registry: productRegistry,
    now: () => new Date("2026-09-04T10:00:00.000Z"),
    createLeaseId: () => "lease_1",
    discoverModels,
    withClient: async (callback: (value: typeof client) => unknown) => await callback(client),
    withTransaction: async (callback: (value: typeof client) => unknown) => await callback(client),
  } as never;
}

function connectedPollFixture(suffix: string) {
  const flow: DeviceFlowState = {
    product: "codex",
    deviceCode: `device-secret-${suffix}`,
    userCode: "ABCD-EFGH",
    verificationUri: "https://example.test/device",
    expiresInSeconds: 600,
    intervalSeconds: 5,
  };
  const attemptId = `attempt_${suffix}`;
  const envelope = encryptCredentialEnvelope(
    flow,
    {
      providerId: provider.id,
      adapterKind: "codex",
      recordKind: "attempt",
      recordId: attemptId,
      revision: 2,
    },
    deviceFlowStateSchema,
  );
  const attempt = {
    id: attemptId,
    provider_id: provider.id,
    adapter_kind: "codex" as const,
    flow_kind: "device_code",
    status: "pending" as const,
    expected_auth_epoch: provider.auth_epoch,
    target_credential_id: null,
    expected_credential_auth_epoch: null,
    expected_credential_revision: null,
    envelope_context_id: provider.id,
    revision: 2,
    idempotency_key_hash: `idem-${suffix}`,
    request_canonical_hash: `canonical-${suffix}`,
    registration_fingerprint: "registration-v1",
    state_hash: null,
    bundle_format_version: envelope.formatVersion,
    bundle_key_id: envelope.keyId,
    bundle_ciphertext: envelope.ciphertext,
    bundle_nonce: envelope.nonce,
    bundle_tag: envelope.tag,
    redirect_uri: null,
    verification_uri: flow.verificationUri,
    expires_at: "2026-09-04T10:10:00.000Z",
    poll_interval_seconds: 5,
    next_poll_at: "2026-09-04T09:59:59.000Z",
    operation_lease_id: null,
    operation_lease_expires_at: null,
    failure_code: null,
    consumed_at: null,
    created_by_admin_id: identity.id,
    created_at: "2026-09-04T09:55:00.000Z",
    updated_at: "2026-09-04T09:55:00.000Z",
  };
  const bundle = {
    product: "codex" as const,
    accessToken: `issued-access-secret-${suffix}`,
    refreshToken: `issued-refresh-secret-${suffix}`,
    expiresAtMs: Date.parse("2026-09-04T11:00:00.000Z"),
    grantedScopes: ["openid", "offline_access"],
    identity: { subject: "same-user", chatgptAccountId: "same-account" },
  };
  const productRegistry = {
    ...registry,
    get: () => ({
      ...registry.get("codex"),
      pollDevice: vi.fn().mockResolvedValue({
        status: "connected",
        product: "codex",
        bundle,
      }),
    }),
  } satisfies ProviderProductRegistry;
  return { attempt, bundle, flow, productRegistry };
}

describe("managed Provider auth orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AI_CREDENTIAL_ENCRYPTION_KEY = "11".repeat(32);
    process.env.AI_PROVIDER_ACCOUNT_IDENTITY_PEPPER = "identity-pepper-".repeat(3);
    mocks.requireAdminRequest.mockResolvedValue(identity);
  });

  it("returns the latest terminal attempt and keeps a disabled Provider out of Gateway-effective state", async () => {
    const terminalAttempt = {
      id: "attempt_1",
      provider_id: provider.id,
      adapter_kind: "codex",
      flow_kind: "device_code",
      status: "failed",
      expected_auth_epoch: 4,
      revision: 3,
      idempotency_key_hash: "idem",
      request_canonical_hash: "canonical",
      registration_fingerprint: "registration-v1",
      state_hash: null,
      bundle_format_version: null,
      bundle_key_id: null,
      bundle_ciphertext: null,
      bundle_nonce: null,
      bundle_tag: null,
      redirect_uri: null,
      verification_uri: null,
      expires_at: null,
      poll_interval_seconds: null,
      next_poll_at: null,
      operation_lease_id: null,
      operation_lease_expires_at: null,
      failure_code: "ACCESS_DENIED",
      consumed_at: "2026-09-04T09:59:00.000Z",
      created_by_admin_id: identity.id,
      created_at: "2026-09-04T09:55:00.000Z",
      updated_at: "2026-09-04T09:59:00.000Z",
    };
    const credential = connectedCredential();
    const currentProvider = { ...provider, managed_credential_id: credential.id };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_providers")) return { rows: [currentProvider] };
      if (sql.includes("FROM ai_provider_managed_credentials")) {
        return { rows: [credential] };
      }
      if (sql.includes("FROM ai_provider_auth_attempts")) return { rows: [terminalAttempt] };
      if (sql.includes("FROM ai_provider_revocation_jobs")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthStatus(
      request(`/api/admin/providers/${provider.id}/managed-auth/status`),
      provider.id,
      dependencies(query),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.attempt).toMatchObject({
      id: terminalAttempt.id,
      status: "failed",
      failureCode: "ACCESS_DENIED",
      ownedByCurrentAdmin: true,
    });
    expect(body.data.readiness).toMatchObject({
      authorizationReady: true,
      credentialConnected: true,
      credentialRegistrationCurrent: true,
      credentialUsable: true,
      effective: false,
    });
    expect(body.data.defaultAccount).toBeNull();
    expect(body.data.binding).toMatchObject({
      mode: "pinned",
      accountId: credential.id,
      providerAuthEpoch: provider.auth_epoch,
    });
    expect(body.data.resolvedAccount).toMatchObject({ accountId: credential.id, authEpoch: 2 });
    expect(body.data.accounts).toEqual([
      expect.objectContaining({ accountId: credential.id, status: "connected" }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(/bundle_ciphertext|deviceCode|accessToken/i);
    const attemptSql = query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("FROM ai_provider_auth_attempts"));
    expect(attemptSql).not.toContain("status IN ('starting', 'pending')");
  });

  it("does not report a connected envelope as usable when the active key cannot open it", async () => {
    const credential = connectedCredential({ bundle_key_id: "sha256:wrong-active-key" });
    const currentProvider = {
      ...provider,
      status: "active" as const,
      managed_credential_id: credential.id,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_providers")) return { rows: [currentProvider] };
      if (sql.includes("FROM ai_provider_managed_credentials")) return { rows: [credential] };
      if (sql.includes("FROM ai_provider_auth_attempts")) return { rows: [] };
      if (sql.includes("FROM ai_provider_revocation_jobs")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthStatus(
      request(`/api/admin/providers/${provider.id}/managed-auth/status`),
      provider.id,
      dependencies(query),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        readiness: {
          credentialConnected: false,
          credentialRegistrationCurrent: true,
          credentialUsable: false,
          effective: false,
          reasons: expect.arrayContaining(["CREDENTIAL_ENVELOPE_UNAVAILABLE"]),
        },
      },
    });
  });

  it("explains an unavailable encryption boundary without exposing configuration values", async () => {
    delete process.env.AI_CREDENTIAL_ENCRYPTION_KEY;
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("GROUP BY managed_credential_id")) return { rows: [] };
      if (sql.includes("FROM ai_providers")) return { rows: [provider] };
      if (sql.includes("FROM ai_provider_managed_credentials")) return { rows: [] };
      if (sql.includes("FROM ai_provider_managed_account_defaults")) return { rows: [] };
      if (sql.includes("FROM ai_provider_auth_attempts")) return { rows: [] };
      if (sql.includes("FROM ai_provider_revocation_jobs")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthStatus(
      request(`/api/admin/providers/${provider.id}/managed-auth/status`),
      provider.id,
      dependencies(query),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.readiness).toMatchObject({
      encryptionKeyReady: false,
      authorizationReady: false,
      reasons: expect.arrayContaining(["CREDENTIAL_ENCRYPTION_KEY_UNAVAILABLE"]),
    });
    expect(JSON.stringify(body)).not.toMatch(/AI_CREDENTIAL_ENCRYPTION_KEY|accessToken|refreshToken/i);
  });

  it("resolves only the account directly owned by the Provider", async () => {
    const ownedAccount = connectedCredential({ id: "managed_owned", auth_epoch: 7 });
    const ownedProvider = {
      ...provider,
      status: "active" as const,
      managed_credential_id: ownedAccount.id,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_providers")) return { rows: [ownedProvider] };
      if (sql.includes("FROM ai_provider_managed_credentials")) {
        return { rows: [ownedAccount] };
      }
      if (sql.includes("FROM ai_provider_auth_attempts")) return { rows: [] };
      if (sql.includes("FROM ai_provider_revocation_jobs")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthStatus(
      request(`/api/admin/providers/${provider.id}/managed-auth/status`),
      provider.id,
      dependencies(query),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        defaultAccount: null,
        binding: { mode: "pinned", accountId: ownedAccount.id },
        resolvedAccount: { accountId: ownedAccount.id, authEpoch: 7 },
        accounts: [expect.objectContaining({ accountId: ownedAccount.id })],
        readiness: { effective: true },
      },
    });
  });

  it("rejects an untargeted start when the Provider already owns a credential", async () => {
    const account = connectedCredential();
    const currentProvider = {
      ...provider,
      status: "active" as const,
      managed_credential_id: account.id,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_providers")) return { rows: [currentProvider], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthStart(
      request(`/api/admin/providers/${provider.id}/managed-auth/start`, {
        expectedAuthEpoch: currentProvider.auth_epoch,
        idempotencyKey: "reauth-without-target",
      }),
      provider.id,
      dependencies(query),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PROVIDER_MANAGED_ACCOUNT_ALREADY_CONNECTED",
        details: { accountId: account.id },
      },
    });
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO"))).toBe(false);
  });

  it("rejects reauthorization of a credential not owned by the Provider", async () => {
    const account = connectedCredential();
    const currentProvider = { ...provider, managed_credential_id: account.id };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_providers")) return { rows: [currentProvider], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthStart(
      request(`/api/admin/providers/${provider.id}/managed-auth/start`, {
        expectedAuthEpoch: currentProvider.auth_epoch,
        targetAccountId: "managed_other_provider",
        expectedAccountEpoch: 1,
        idempotencyKey: "reauth-wrong-owner",
      }),
      provider.id,
      dependencies(query),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_MANAGED_ACCOUNT_NOT_OWNED" },
    });
  });

  it("retires product-wide default and binding mutations", async () => {
    const query = vi.fn();
    const defaultResponse = await handleProviderManagedAuthSetDefault(
      request(`/api/admin/providers/${provider.id}/managed-auth/accounts/managed_1/default`, {}),
      provider.id,
      "managed_1",
      dependencies(query),
    );
    const bindingResponse = await handleProviderManagedAuthSetBinding(
      request(`/api/admin/providers/${provider.id}/managed-auth/binding`, {}),
      provider.id,
      dependencies(query),
    );

    expect(defaultResponse.status).toBe(410);
    expect(bindingResponse.status).toBe(410);
    await expect(defaultResponse.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_MANAGED_ACCOUNT_POOL_UNSUPPORTED" },
    });
    await expect(bindingResponse.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_MANAGED_ACCOUNT_POOL_UNSUPPORTED" },
    });
    expect(query).not.toHaveBeenCalled();
  });

  it("keeps a retryable upstream poll failure pending and schedules the next fenced poll", async () => {
    const flow: DeviceFlowState = {
      product: "codex",
      deviceCode: "device-secret-never-return",
      userCode: "ABCD-EFGH",
      verificationUri: "https://example.test/device",
      expiresInSeconds: 600,
      intervalSeconds: 5,
    };
    const envelope = encryptCredentialEnvelope(
      flow,
      {
        providerId: provider.id,
        adapterKind: "codex",
        recordKind: "attempt",
        recordId: "attempt_2",
        revision: 2,
      },
      deviceFlowStateSchema,
    );
    const attempt = {
      id: "attempt_2",
      provider_id: provider.id,
      adapter_kind: "codex" as const,
      flow_kind: "device_code",
      status: "pending" as const,
      expected_auth_epoch: provider.auth_epoch,
      revision: 2,
      idempotency_key_hash: "idem",
      request_canonical_hash: "canonical",
      registration_fingerprint: "registration-v1",
      state_hash: null,
      bundle_format_version: envelope.formatVersion,
      bundle_key_id: envelope.keyId,
      bundle_ciphertext: envelope.ciphertext,
      bundle_nonce: envelope.nonce,
      bundle_tag: envelope.tag,
      envelope_context_id: provider.id,
      redirect_uri: null,
      verification_uri: flow.verificationUri,
      expires_at: "2026-09-04T10:10:00.000Z",
      poll_interval_seconds: 5,
      next_poll_at: "2026-09-04T09:59:59.000Z",
      operation_lease_id: null,
      operation_lease_expires_at: null,
      failure_code: null,
      consumed_at: null,
      created_by_admin_id: identity.id,
      created_at: "2026-09-04T09:55:00.000Z",
      updated_at: "2026-09-04T09:55:00.000Z",
    };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("SET operation_lease_id = $3")) {
        return { rows: [{ ...attempt, operation_lease_id: values?.[2], operation_lease_expires_at: values?.[3] }] };
      }
      if (sql.includes("SET revision = $5")) {
        return {
          rows: [{
            ...attempt,
            revision: values?.[4],
            next_poll_at: values?.[6],
            operation_lease_id: null,
            operation_lease_expires_at: null,
          }],
        };
      }
      if (sql.includes("FROM ai_provider_auth_attempts") && sql.includes("WHERE id = $1")) {
        return { rows: [attempt] };
      }
      if (sql.includes("FROM ai_providers")) return { rows: [provider] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const retryRegistry = {
      ...registry,
      get: () => ({
        ...registry.get("codex"),
        pollDevice: vi.fn().mockResolvedValue({
          status: "failed",
          product: "codex",
          error: {
            code: "UPSTREAM_TEMPORARY",
            category: "network",
            message: "temporary",
            retryable: true,
            httpStatus: 503,
          },
        }),
      }),
    } satisfies ProviderProductRegistry;

    const response = await handleProviderManagedAuthPoll(
      request(`/api/admin/provider-auth-attempts/${attempt.id}/poll`, { expectedRevision: 2 }),
      attempt.id,
      dependencies(query, retryRegistry),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: { id: attempt.id, status: "pending", revision: 3 },
      warning: { code: "UPSTREAM_TEMPORARY", retryable: true },
    });
    expect(JSON.stringify(body)).not.toContain(flow.deviceCode);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("status = 'failed'"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("SET revision = $5"))).toBe(true);
  });

  it("persists and revokes a grant that fails post-authorization validation", async () => {
    const flow: DeviceFlowState = {
      product: "codex",
      deviceCode: "device-secret-never-return",
      userCode: "ABCD-EFGH",
      verificationUri: "https://example.test/device",
      expiresInSeconds: 600,
      intervalSeconds: 5,
    };
    const envelope = encryptCredentialEnvelope(
      flow,
      {
        providerId: provider.id,
        adapterKind: "codex",
        recordKind: "attempt",
        recordId: "attempt_rejected",
        revision: 2,
      },
      deviceFlowStateSchema,
    );
    const attempt = {
      id: "attempt_rejected",
      provider_id: provider.id,
      adapter_kind: "codex" as const,
      status: "pending" as const,
      expected_auth_epoch: provider.auth_epoch,
      revision: 2,
      registration_fingerprint: "registration-v1",
      created_by_admin_id: identity.id,
      expires_at: "2026-09-04T10:10:00.000Z",
      next_poll_at: "2026-09-04T09:59:59.000Z",
      operation_lease_id: null,
      operation_lease_expires_at: null,
      bundle_format_version: envelope.formatVersion,
      bundle_key_id: envelope.keyId,
      bundle_ciphertext: envelope.ciphertext,
      bundle_nonce: envelope.nonce,
      bundle_tag: envelope.tag,
      envelope_context_id: provider.id,
    };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("FROM ai_provider_auth_attempts") && sql.includes("WHERE id = $1")) {
        return { rows: [attempt], rowCount: 1 };
      }
      if (sql.includes("FROM ai_providers")) return { rows: [provider], rowCount: 1 };
      if (sql.includes("SET operation_lease_id = $3")) {
        return { rows: [{ ...attempt, operation_lease_id: values?.[2] }], rowCount: 1 };
      }
      if (sql.includes("SET status = 'failed'")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });
    const rejectedRegistry = {
      ...registry,
      get: () => ({
        ...registry.get("codex"),
        pollDevice: vi.fn().mockResolvedValue({
          status: "failed",
          product: "codex",
          error: {
            code: "PROVIDER_REQUIRED_SCOPE_MISSING",
            category: "authorization",
            message: "safe",
            retryable: false,
          },
          revocationHandoff: createProviderRevocationHandoff({
            product: "codex",
            refreshToken: "rejected-refresh-secret",
          }),
        }),
      }),
    } satisfies ProviderProductRegistry;

    const response = await handleProviderManagedAuthPoll(
      request(`/api/admin/provider-auth-attempts/${attempt.id}/poll`, { expectedRevision: 2 }),
      attempt.id,
      dependencies(query, rejectedRegistry),
    );

    expect(response.status).toBe(502);
    expect(mocks.enqueueRevocation).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      reason: "activation_rejected",
      material: { product: "codex", refreshToken: "rejected-refresh-secret" },
    }));
    expect(mocks.processRevocation).toHaveBeenCalledWith(
      "revocationjob-admin",
      expect.objectContaining({ force: true }),
    );
    expect(JSON.stringify(await response.json())).not.toContain("rejected-refresh-secret");
  });

  it("keeps a live Provider account identity exclusive during poll completion", async () => {
    const fixture = connectedPollFixture("live-owner-conflict");
    const claimedAttempt = { ...fixture.attempt, operation_lease_id: "lease_1" };
    const liveCredential = connectedCredential({
      id: "managed_live_owner",
      provider_id: "provider_live_owner",
    });
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("poll_deadline_expired")) {
        return { rows: [fixture.attempt], rowCount: 1 };
      }
      if (sql.includes("SET operation_lease_id = $3")) {
        return { rows: [claimedAttempt], rowCount: 1 };
      }
      if (sql.includes("SELECT * FROM ai_provider_auth_attempts")) {
        return {
          rows: [sql.includes("FOR UPDATE") ? claimedAttempt : fixture.attempt],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM ai_provider_managed_credentials") && sql.includes("account_identity_hash")) {
        return { rows: [liveCredential], rowCount: 1 };
      }
      if (sql.includes("FROM ai_providers") && values?.[0] === "provider_live_owner") {
        return {
          rows: [{
            ...provider,
            id: "provider_live_owner",
            status: "active",
            managed_credential_id: liveCredential.id,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM ai_providers")) return { rows: [provider], rowCount: 1 };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("SET status = 'failed'")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthPoll(
      request(`/api/admin/provider-auth-attempts/${fixture.attempt.id}/poll`, {
        expectedRevision: fixture.attempt.revision,
      }),
      fixture.attempt.id,
      dependencies(query, fixture.productRegistry),
    );

    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body).toMatchObject({
      error: {
        code: "PROVIDER_MANAGED_ACCOUNT_ALREADY_EXISTS",
        details: { accountId: liveCredential.id },
      },
    });
    expect(JSON.stringify(body)).not.toContain(fixture.bundle.accessToken);
    expect(JSON.stringify(body)).not.toContain(fixture.bundle.refreshToken);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO ai_provider_managed_credentials"))).toBe(false);
  });

  it.each([
    {
      label: "a deleted Provider",
      providerId: "provider_deleted_owner",
      providerStatus: "deleted",
      discoveryFails: false,
    },
    {
      label: "no Provider",
      providerId: null,
      providerStatus: null,
      discoveryFails: true,
    },
  ])("recovers the same account identity left connected by $label", async ({
    providerId: orphanProviderId,
    providerStatus,
    discoveryFails,
  }) => {
    const fixture = connectedPollFixture(`orphan-${providerStatus ?? "unbound"}`);
    const claimedAttempt = { ...fixture.attempt, operation_lease_id: "lease_1" };
    const orphan = connectedCredential({
      id: `managed_orphan_${providerStatus ?? "unbound"}`,
      provider_id: orphanProviderId,
    });
    const released = {
      ...orphan,
      provider_id: null,
      status: "disconnected",
      auth_epoch: Number(orphan.auth_epoch) + 1,
      revision: Number(orphan.revision) + 1,
      bundle_format_version: null,
      bundle_key_id: null,
      bundle_ciphertext: null,
      bundle_nonce: null,
      bundle_tag: null,
      granted_scopes: [],
      refresh_lease_id: null,
      refresh_lease_expires_at: null,
      revocation_status: "not_attempted",
    };
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("poll_deadline_expired")) {
        return { rows: [fixture.attempt], rowCount: 1 };
      }
      if (sql.includes("SET operation_lease_id = $3")) {
        return { rows: [claimedAttempt], rowCount: 1 };
      }
      if (sql.includes("SELECT * FROM ai_provider_auth_attempts")) {
        return {
          rows: [sql.includes("FOR UPDATE") ? claimedAttempt : fixture.attempt],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM ai_provider_managed_credentials") && sql.includes("account_identity_hash")) {
        return { rows: [orphan], rowCount: 1 };
      }
      if (orphanProviderId && sql.includes("FROM ai_providers") && values?.[0] === orphanProviderId) {
        return {
          rows: [{
            ...provider,
            id: orphanProviderId,
            status: providerStatus,
            managed_credential_id: orphan.id,
          }],
          rowCount: 1,
        };
      }
      if (sql.includes("FROM ai_providers")) return { rows: [provider], rowCount: 1 };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("UPDATE ai_provider_managed_credentials")) {
        return { rows: [released], rowCount: 1 };
      }
      if (sql.includes("INSERT INTO ai_provider_managed_credentials")) {
        return { rows: [], rowCount: 1 };
      }
      if (sql.includes("UPDATE ai_providers")) {
        return { rows: [{ auth_epoch: provider.auth_epoch + 1 }], rowCount: 1 };
      }
      if (sql.includes("SET status = 'succeeded'")) return { rows: [], rowCount: 1 };
      if (sql.includes("SET status = 'failed'")) return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const discoverModels = discoveryFails
      ? vi.fn().mockRejectedValue(new Error("catalog unavailable"))
      : vi.fn().mockResolvedValue({
          id: "discovery_after_connect",
          discoveredCount: 2,
          newCount: 2,
          conflictCount: 0,
          unsupportedCount: 0,
          reused: false,
        });
    const response = await handleProviderManagedAuthPoll(
      request(`/api/admin/provider-auth-attempts/${fixture.attempt.id}/poll`, {
        expectedRevision: fixture.attempt.revision,
      }),
      fixture.attempt.id,
      dependencies(query, fixture.productRegistry, discoverModels),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      data: {
        id: fixture.attempt.id,
        status: "succeeded",
        credentialStatus: "connected",
        authEpoch: provider.auth_epoch + 1,
        catalogSync: discoveryFails
          ? { status: "failed", code: "PROVIDER_MODEL_DISCOVERY_FAILED" }
          : {
              status: "succeeded",
              snapshotId: "discovery_after_connect",
              discoveredCount: 2,
              newCount: 2,
              conflictCount: 0,
              unsupportedCount: 0,
              reused: false,
            },
      },
    });
    expect(discoverModels).toHaveBeenCalledWith(expect.objectContaining({
      providerId: provider.id,
      identity,
      requestId: "admin_managed_auth_test",
    }));
    expect(JSON.stringify(body)).not.toContain(fixture.bundle.accessToken);
    expect(JSON.stringify(body)).not.toContain(fixture.bundle.refreshToken);
    expect(JSON.stringify(body)).not.toContain("access-secret-never-return");
    expect(JSON.stringify(body)).not.toContain("refresh-secret-never-return");
    const orphanRetirement = query.mock.calls
      .map(([sql]) => String(sql))
      .find((statement) => statement.includes("UPDATE ai_provider_managed_credentials"));
    expect(orphanRetirement).toContain("provider_id = NULL");
    expect(orphanRetirement).toContain("bundle_ciphertext = NULL");
    expect(orphanRetirement).toContain("refresh_lease_id = NULL");
    expect(orphanRetirement).toContain("refresh_lease_expires_at = NULL");
    expect(orphanRetirement).toContain("granted_scopes = ARRAY[]::text[]");
    expect(orphanRetirement).toContain("revocation_status = 'not_attempted'");
  });

  it("never projects Device secrets from a pending attempt", () => {
    const projected = providerManagedAuthTestExports.attemptProjection({
      status: "pending",
      revision: 1,
      expected_auth_epoch: 1,
      failure_code: null,
      expires_at: null,
      next_poll_at: null,
      poll_interval_seconds: 5,
      created_at: "2026-09-04T00:00:00.000Z",
      updated_at: "2026-09-04T00:00:00.000Z",
      id: "attempt_safe",
    } as never, {
      product: "codex",
      deviceCode: "device-secret-never-return",
      userCode: "SAFE-CODE",
      verificationUri: "https://example.test/device",
      expiresInSeconds: 600,
      intervalSeconds: 5,
    });
    expect(projected).toMatchObject({ userCode: "SAFE-CODE" });
    expect(JSON.stringify(projected)).not.toContain("device-secret-never-return");
  });

  it("hides the user code and verification URL from administrators who do not own the attempt", () => {
    const projected = providerManagedAuthTestExports.attemptProjection({
      status: "pending",
      revision: 2,
      expected_auth_epoch: 1,
      failure_code: null,
      expires_at: "2026-09-04T00:10:00.000Z",
      next_poll_at: "2026-09-04T00:00:05.000Z",
      poll_interval_seconds: 5,
      verification_uri: "https://auth.openai.com/codex/device",
      created_by_admin_id: "admin-owner",
      created_at: "2026-09-04T00:00:00.000Z",
      updated_at: "2026-09-04T00:00:00.000Z",
      id: "attempt_private",
    } as never, {
      product: "codex",
      deviceCode: "device-secret-never-return",
      userCode: "OWNER-ONLY",
      verificationUri: "https://auth.openai.com/codex/device",
      verificationUriComplete: "https://auth.openai.com/codex/device?code=OWNER-ONLY",
      expiresInSeconds: 600,
      intervalSeconds: 5,
    }, "admin-reader");

    expect(projected).toMatchObject({
      ownedByCurrentAdmin: false,
      userCode: null,
      verificationUri: null,
      verificationUriComplete: null,
    });
  });

  it("persists only the validated safe scope projection from a product bundle", () => {
    expect(providerManagedAuthTestExports.grantedScopesProjection({
      product: "codex",
      accessToken: "hidden-access",
      refreshToken: "hidden-refresh",
      expiresAtMs: Date.parse("2026-09-04T11:00:00.000Z"),
      grantedScopes: ["openid", "offline_access"],
      identity: { subject: "subject_1", chatgptAccountId: "account_1" },
    })).toEqual(["openid", "offline_access"]);
  });

  it("requires the account-scoped route for the legacy Provider disconnect action", async () => {
    const activeProvider = { ...provider, status: "active" as const };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_providers")) return { rows: [activeProvider], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthDisconnect(
      request(`/api/admin/providers/${provider.id}/managed-auth/disconnect`, {
        expectedAuthEpoch: activeProvider.auth_epoch,
      }),
      provider.id,
      dependencies(query),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PROVIDER_MANAGED_ACCOUNT_ROUTE_REQUIRED",
      },
    });
    expect(query.mock.calls.some(([sql]) => /^\s*UPDATE\b/.test(String(sql)))).toBe(false);
  });

  it("fences account removal on the managed account auth epoch", async () => {
    const account = connectedCredential({ auth_epoch: 5, revision: 7 });
    const currentProvider = { ...provider, managed_credential_id: account.id };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM ai_providers")) return { rows: [currentProvider], rowCount: 1 };
      if (sql.includes("FROM ai_provider_managed_credentials")) {
        return { rows: [account], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthDisconnectAccount(
      request(
        `/api/admin/providers/${provider.id}/managed-auth/accounts/${account.id}/disconnect`,
        { expectedAccountEpoch: 4, expectedRevision: account.revision },
      ),
      provider.id,
      account.id,
      dependencies(query),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PROVIDER_MANAGED_ACCOUNT_STALE",
        details: { currentAccountEpoch: 5, currentRevision: 7 },
      },
    });
    expect(query.mock.calls.some(([sql]) => /^\s*UPDATE\b/.test(String(sql)))).toBe(false);
  });

  it("disconnects only the current owned account and clears the Provider pointer", async () => {
    const account = connectedCredential({ auth_epoch: 5, revision: 7 });
    const currentProvider = { ...provider, managed_credential_id: account.id };
    const disconnected = {
      ...account,
      status: "disconnected",
      auth_epoch: 6,
      revision: 8,
    };
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [], rowCount: 1 };
      if (sql.includes("FROM ai_providers")) return { rows: [currentProvider], rowCount: 1 };
      if (sql.includes("FROM ai_provider_managed_credentials")) {
        return { rows: [account], rowCount: 1 };
      }
      if (sql.includes("UPDATE ai_provider_auth_attempts")) return { rows: [], rowCount: 0 };
      if (sql.includes("UPDATE ai_provider_managed_credentials")) {
        return { rows: [disconnected], rowCount: 1 };
      }
      if (sql.includes("UPDATE ai_providers")) return { rows: [{ auth_epoch: 5 }], rowCount: 1 };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthDisconnectAccount(
      request(
        `/api/admin/providers/${provider.id}/managed-auth/accounts/${account.id}/disconnect`,
        { expectedAccountEpoch: account.auth_epoch, expectedRevision: account.revision },
      ),
      provider.id,
      account.id,
      dependencies(query),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        accountId: account.id,
        status: "disconnected",
        authEpoch: 6,
        providerAuthEpoch: 5,
      },
    });
    const credentialUpdate = query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("UPDATE ai_provider_managed_credentials"));
    expect(credentialUpdate).toContain("provider_id = $5");
    const providerUpdate = query.mock.calls
      .map(([sql]) => String(sql))
      .find((sql) => sql.includes("UPDATE ai_providers"));
    expect(providerUpdate).toContain("managed_credential_id = NULL");
    expect(providerUpdate).toContain("managed_credential_id = $3");
  });

  it("retries a failed revocation through the permission and revision-fenced Admin boundary", async () => {
    const job = {
      id: "revocationjob_1",
      provider_id: provider.id,
      adapter_kind: "codex",
      status: "failed",
      revision: 3,
      failure_code: "REMOTE_REVOKE_FAILED",
      attempt_count: 1,
      managed_credential_id: "managed_1",
    };
    mocks.processRevocation.mockResolvedValueOnce({
      ...job,
      status: "succeeded",
      revision: 5,
      failure_code: null,
      attempt_count: 2,
    });
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_providers")) return { rows: [provider] };
      if (sql.includes("FROM ai_provider_revocation_jobs")) return { rows: [job] };
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthRevocationRetry(
      request(`/api/admin/providers/${provider.id}/managed-auth/revocations/retry`, {
        jobId: job.id,
        accountId: "managed_1",
        expectedRevision: 3,
      }),
      provider.id,
      dependencies(query),
    );

    expect(response.status).toBe(200);
    expect(mocks.requireAdminRequest).toHaveBeenCalledWith(expect.any(Request), "providers.write");
    expect(mocks.processRevocation).toHaveBeenCalledWith(job.id, expect.objectContaining({
      force: true,
      expectedRevision: 3,
    }));
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: "managed_auth_remote_revocation_retry",
    }));
    expect(JSON.stringify(await response.json())).not.toMatch(/refresh|accessToken|ciphertext/i);
  });

  it("rejects a stale revocation retry before any remote work", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM ai_providers")) return { rows: [provider] };
      if (sql.includes("FROM ai_provider_revocation_jobs")) {
        return {
          rows: [{
            id: "revocationjob_1",
            provider_id: provider.id,
            managed_credential_id: "managed_1",
            revision: 4,
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    });

    const response = await handleProviderManagedAuthRevocationRetry(
      request(`/api/admin/providers/${provider.id}/managed-auth/revocations/retry`, {
        jobId: "revocationjob_1",
        accountId: "managed_1",
        expectedRevision: 3,
      }),
      provider.id,
      dependencies(query),
    );

    expect(response.status).toBe(409);
    expect(mocks.processRevocation).not.toHaveBeenCalled();
  });
});
