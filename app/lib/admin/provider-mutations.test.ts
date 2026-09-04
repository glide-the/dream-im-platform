// [Input] Generic/managed Provider HTTP writes and mocked PostgreSQL credential lifecycle receipts.
// [Output] Coverage for credential lifecycle plus revisioned, dependency-gated Provider deletion.
// [Pos] Focused regression tests for Provider mutation integration without external Provider calls.
// [Sync] 2026-09-04: cover static validation plus Provider-owned managed-account gates.
// [Sync] 2026-09-04: cover model/Pricing delete conflicts, tombstones, and secret-safe audit.
// [Sync] 2026-09-04: block tombstoning while an unpointed live managed credential remains.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  providerKindQuery: vi.fn(),
  transaction: vi.fn(),
  requireAdminRequest: vi.fn(),
  assertAdminMutationOrigin: vi.fn(),
  audit: vi.fn(),
  encrypt: vi.fn(),
  prepare: vi.fn(),
  recordConflict: vi.fn(),
  providerReadiness: vi.fn(),
  encryptionKey: vi.fn(),
  decryptEnvelope: vi.fn(),
}));

vi.mock("../platform-db", () => ({
  withPlatformTransaction: mocks.transaction,
  withPlatformClient: async (
    callback: (client: { query: typeof mocks.providerKindQuery }) => unknown,
  ) => await callback({ query: mocks.providerKindQuery }),
}));

vi.mock("./guard", () => ({
  adminRequestId: () => "admin_provider_mutation_test",
  requireAdminRequest: mocks.requireAdminRequest,
  assertAdminMutationOrigin: mocks.assertAdminMutationOrigin,
}));

vi.mock("./audit", () => ({
  recordAdminAuditOnClient: mocks.audit,
}));

vi.mock("../security/credential-encryption", () => ({
  CredentialConfigurationError: class CredentialConfigurationError extends Error {},
  encryptCredential: mocks.encrypt,
  getCredentialEncryptionKey: mocks.encryptionKey,
}));

vi.mock("../security/credential-envelope", () => ({
  decryptCredentialEnvelope: mocks.decryptEnvelope,
}));

vi.mock("../providers", () => ({
  getProviderProductRegistry: () => ({ readiness: mocks.providerReadiness }),
}));

vi.mock("./provider-credentials", () => ({
  prepareProviderCredentialUpdate: mocks.prepare,
  recordProviderCredentialRevisionConflict: mocks.recordConflict,
}));

import {
  handleAdminResourceCreate,
  handleAdminResourceDelete,
  handleAdminResourceUpdate,
} from "./mutations";

const identity = {
  id: "admin_1",
  email: "admin@example.com",
  roles: ["operator"],
  permissions: ["providers.write"],
  sessionId: "session_1",
};

const encrypted = {
  ciphertext: "encrypted-candidate",
  iv: "candidate-iv",
  tag: "candidate-tag",
  fingerprint: "sha256:candidate",
};

const before = {
  id: "provider_1",
  code: "provider-one",
  name: "Provider One",
  adapter_kind: "generic",
  active_credential_kind: "static_api_key",
  auth_epoch: 1,
  protocol: "anthropic",
  base_url: "https://api.anthropic.com",
  status: "disabled",
  timeout_ms: 120_000,
  max_retries: 1,
  config: { authMode: "x-api-key" },
  api_key_ciphertext: "old-ciphertext",
  api_key_iv: "old-iv",
  api_key_tag: "old-tag",
  api_key_fingerprint: "sha256:old",
  auth_revision: 1,
  credential_validation_status: "unverified",
  credential_validated_at: null,
  created_at: "2026-09-04T00:00:00.000Z",
  updated_at: "2026-09-04T00:00:00.000Z",
  delete_revision: "0123456789abcdef0123456789abcdef",
};

function mutationRequest(
  path: string,
  method: "POST" | "PATCH" | "DELETE",
  body: Record<string, unknown>,
) {
  return new Request(`https://admin.test${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://admin.test",
    },
    body: JSON.stringify(body),
  });
}

describe("Provider mutation credential lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdminRequest.mockResolvedValue(identity);
    mocks.transaction.mockImplementation(async (callback) =>
      await callback({ query: mocks.query }),
    );
    mocks.encrypt.mockReturnValue(encrypted);
    mocks.prepare.mockResolvedValue({ sensitive: false });
    mocks.encryptionKey.mockReturnValue(Buffer.alloc(32));
    mocks.decryptEnvelope.mockReturnValue({ product: "codex" });
    mocks.providerReadiness.mockReturnValue({
      status: "ready",
      registrationFingerprint: "registration-v1",
      oauthAppConfigured: true,
      integrationProfileConfigured: true,
    });
    mocks.providerKindQuery.mockResolvedValue({ rows: [{ adapter_kind: "generic" }] });
  });

  it("creates a disabled Provider with unverified revision-one metadata", async () => {
    const secret = "candidate-secret-never-return";
    mocks.query.mockResolvedValueOnce({
      rows: [{
        ...before,
        api_key_fingerprint: encrypted.fingerprint,
        credential_configured: true,
      }],
    });
    const response = await handleAdminResourceCreate(
      mutationRequest("/api/admin/providers", "POST", {
        code: "provider-one",
        name: "Provider One",
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        apiKey: secret,
        status: "disabled",
        config: { authMode: "x-api-key" },
      }),
      "providers",
    );

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data).toMatchObject({
      auth_revision: 1,
      credential_validation_status: "unverified",
      credential_validated_at: null,
      credential_configured: true,
    });
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(JSON.stringify(mocks.audit.mock.calls[0]?.[1])).not.toContain(secret);
  });

  it("returns an actionable conflict when a Provider Code already exists", async () => {
    mocks.query.mockRejectedValueOnce(Object.assign(
      new Error("duplicate key value violates unique constraint"),
      { code: "23505", constraint: "ai_providers_code_uidx" },
    ));

    const response = await handleAdminResourceCreate(
      mutationRequest("/api/admin/providers", "POST", {
        code: "provider-one",
        name: "Another Provider",
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        status: "disabled",
        config: { authMode: "x-api-key" },
      }),
      "providers",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PROVIDER_CODE_CONFLICT",
        message: expect.stringContaining("Provider Code"),
      },
    });
  });

  it("rejects OpenAI x-api-key configuration even for a disabled create", async () => {
    const response = await handleAdminResourceCreate(
      mutationRequest("/api/admin/providers", "POST", {
        code: "openai-invalid",
        name: "OpenAI Invalid",
        protocol: "openai",
        baseUrl: "https://api.openai.com",
        apiKey: "candidate-secret",
        status: "disabled",
        config: { authMode: "x-api-key" },
      }),
      "providers",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_AUTH_MODE_INVALID" },
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it.each([
    "apiKey",
    "api_key",
    "accessToken",
    "access_token",
    "refreshToken",
    "refresh_token",
    "clientSecret",
    "client_secret",
    "authorization",
    "password",
    "cookie",
    "secret",
    "token",
    "credential",
  ])("recursively rejects config key %s without returning its value", async (key) => {
    const secret = "nested-secret-value-never-return";
    const response = await handleAdminResourceCreate(
      mutationRequest("/api/admin/providers", "POST", {
        code: "provider-secret-config",
        name: "Provider Secret Config",
        protocol: "anthropic",
        baseUrl: "https://api.anthropic.com",
        status: "disabled",
        config: {
          authMode: "x-api-key",
          nested: [{ [key]: secret }],
        },
      }),
      "providers",
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("ADMIN_INPUT_INVALID");
    expect(JSON.stringify(body)).toContain(key);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("allows explicit non-secret Token configuration names", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        ...before,
        protocol: "openai",
        config: { authMode: "bearer", outputTokenParam: "max_completion_tokens" },
        credential_configured: false,
      }],
    });
    const response = await handleAdminResourceCreate(
      mutationRequest("/api/admin/providers", "POST", {
        code: "openai-output-token",
        name: "OpenAI Output Token",
        protocol: "openai",
        baseUrl: "https://api.openai.com",
        status: "disabled",
        config: {
          authMode: "bearer",
          outputTokenParam: "max_completion_tokens",
        },
      }),
      "providers",
    );

    expect(response.status).toBe(201);
  });

  it("requires a strict positive number for expectedAuthRevision", async () => {
    const response = await handleAdminResourceUpdate(
      mutationRequest("/api/admin/providers/provider_1", "PATCH", {
        apiKey: "candidate-secret",
        expectedAuthRevision: "1",
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_INPUT_INVALID" },
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("atomically publishes a validated credential and increments auth revision", async () => {
    mocks.prepare.mockResolvedValueOnce({
      sensitive: true,
      expectedAuthRevision: 1,
      validatedAt: new Date("2026-09-04T00:10:00.000Z"),
      validationModelCode: "claude-fixture",
    });
    mocks.query
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({
        rows: [{
          ...before,
          status: "active",
          auth_revision: 2,
          credential_validation_status: "valid",
          credential_validated_at: "2026-09-04T00:10:00.000Z",
          api_key_fingerprint: encrypted.fingerprint,
          credential_configured: true,
        }],
      });
    const response = await handleAdminResourceUpdate(
      mutationRequest("/api/admin/providers/provider_1", "PATCH", {
        apiKey: "candidate-secret",
        status: "active",
        expectedAuthRevision: 1,
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        auth_revision: 2,
        credential_validation_status: "valid",
      },
    });
    const updateSql = String(mocks.query.mock.calls[1]?.[0]);
    expect(updateSql).toContain("auth_revision");
    expect(updateSql).toContain("credential_validation_status");
    expect(updateSql).toContain("credential_validated_at");
  });

  it("does not increment auth revision for an ordinary PATCH", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [{ ...before, name: "Renamed", credential_configured: true }] });
    const response = await handleAdminResourceUpdate(
      mutationRequest("/api/admin/providers/provider_1", "PATCH", {
        name: "Renamed",
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(200);
    const updateSql = String(mocks.query.mock.calls[1]?.[0]);
    expect(updateSql).not.toContain("auth_revision =");
    expect(mocks.prepare).toHaveBeenCalledOnce();
  });

  it("removes historical config secrets from an ordinary PATCH response and audit", async () => {
    const historicalSecret = "historical-secret-never-return";
    const dirtyBefore = {
      ...before,
      config: {
        authMode: "x-api-key",
        nested: { refresh_token: historicalSecret, safe: "visible" },
      },
    };
    mocks.query
      .mockResolvedValueOnce({ rows: [dirtyBefore] })
      .mockResolvedValueOnce({
        rows: [{ ...dirtyBefore, name: "Renamed", credential_configured: true }],
      });
    const response = await handleAdminResourceUpdate(
      mutationRequest("/api/admin/providers/provider_1", "PATCH", {
        name: "Renamed",
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.config.nested).toEqual({ safe: "visible" });
    expect(JSON.stringify(body)).not.toContain(historicalSecret);
    const audit = mocks.audit.mock.calls[0]?.[1];
    expect(audit.before.config.nested).toEqual({ safe: "visible" });
    expect(audit.after.config.nested).toEqual({ safe: "visible" });
    expect(JSON.stringify(audit)).not.toContain(historicalSecret);
  });

  it("returns 409 and audits a final CAS conflict without replacing ciphertext", async () => {
    mocks.prepare.mockResolvedValueOnce({
      sensitive: true,
      expectedAuthRevision: 1,
      validatedAt: new Date("2026-09-04T00:10:00.000Z"),
      validationModelCode: "claude-fixture",
    });
    mocks.query.mockResolvedValueOnce({
      rows: [{ ...before, auth_revision: 2 }],
    });
    const response = await handleAdminResourceUpdate(
      mutationRequest("/api/admin/providers/provider_1", "PATCH", {
        apiKey: "candidate-secret",
        expectedAuthRevision: 1,
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(409);
    expect(mocks.encrypt).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.recordConflict).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: "provider_1",
        currentAuthRevision: 2,
        expectedAuthRevision: 1,
      }),
    );
  });

  it("creates a disabled managed product without endpoint or static credential material", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{
        ...before,
        id: "provider_codex",
        code: "codex-main",
        name: "Codex",
        adapter_kind: "codex",
        active_credential_kind: "none",
        protocol: "openai",
        base_url: null,
        credential_configured: false,
      }],
    });

    const response = await handleAdminResourceCreate(
      mutationRequest("/api/admin/providers", "POST", {
        code: "codex-main",
        name: "Codex",
        adapterKind: "codex",
        protocol: "openai",
        status: "disabled",
        config: { modelCatalogMode: "auto" },
      }),
      "providers",
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        adapter_kind: "codex",
        active_credential_kind: "none",
        base_url: null,
      },
    });
    expect(mocks.encrypt).not.toHaveBeenCalled();
    const values = mocks.query.mock.calls[0]?.[1];
    expect(values).toEqual(expect.arrayContaining(["codex", "openai", null, "none", "pinned"]));
  });

  it("requires a connected managed credential before activation", async () => {
    mocks.providerKindQuery.mockResolvedValueOnce({ rows: [{ adapter_kind: "codex" }] });
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          ...before,
          adapter_kind: "codex",
          active_credential_kind: "none",
          protocol: "openai",
          base_url: null,
          api_key_ciphertext: null,
          api_key_iv: null,
          api_key_tag: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          credential_ready: false,
          registration_fingerprint: null,
          model_ready: true,
          pricing_ready: true,
        }],
      });

    const response = await handleAdminResourceUpdate(
      mutationRequest("/api/admin/providers/provider_1", "PATCH", { status: "active" }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_MANAGED_CREDENTIAL_REQUIRED" },
    });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });

  it("rejects activation when the connected credential uses an old registration", async () => {
    mocks.providerKindQuery.mockResolvedValueOnce({ rows: [{ adapter_kind: "codex" }] });
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          ...before,
          adapter_kind: "codex",
          active_credential_kind: "none",
          protocol: "openai",
          base_url: null,
          api_key_ciphertext: null,
          api_key_iv: null,
          api_key_tag: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          credential_ready: true,
          registration_fingerprint: "registration-old",
          model_ready: true,
          pricing_ready: true,
        }],
      });

    const response = await handleAdminResourceUpdate(
      mutationRequest("/api/admin/providers/provider_1", "PATCH", { status: "active" }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_MANAGED_CREDENTIAL_REGISTRATION_STALE" },
    });
  });

  it("rejects activation when the current key cannot open the connected credential", async () => {
    mocks.providerKindQuery.mockResolvedValueOnce({ rows: [{ adapter_kind: "codex" }] });
    mocks.decryptEnvelope.mockImplementationOnce(() => {
      throw new Error("key mismatch");
    });
    mocks.query
      .mockResolvedValueOnce({
        rows: [{
          ...before,
          adapter_kind: "codex",
          active_credential_kind: "none",
          protocol: "openai",
          base_url: null,
          api_key_ciphertext: null,
          api_key_iv: null,
          api_key_tag: null,
        }],
      })
      .mockResolvedValueOnce({
        rows: [{
          credential_ready: true,
          credential_id: "managed_1",
          credential_revision: 2,
          bundle_format_version: 1,
          bundle_key_id: "key-current",
          bundle_ciphertext: "encrypted",
          bundle_nonce: "nonce",
          bundle_tag: "tag",
          registration_fingerprint: "registration-v1",
          model_ready: true,
          pricing_ready: true,
        }],
      });

    const response = await handleAdminResourceUpdate(
      mutationRequest("/api/admin/providers/provider_1", "PATCH", { status: "active" }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_MANAGED_CREDENTIAL_UNAVAILABLE" },
    });
  });

  it("rejects product registration or endpoint overrides in managed config", async () => {
    const response = await handleAdminResourceCreate(
      mutationRequest("/api/admin/providers", "POST", {
        code: "xai-main",
        name: "xAI",
        adapterKind: "xai",
        protocol: "openai",
        status: "disabled",
        config: { nested: { clientId: "operator-supplied-client" } },
      }),
      "providers",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PROVIDER_MANAGED_PRODUCT_CONFIG_NOT_EDITABLE",
        details: { path: ["nested", "clientId"] },
      },
    });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("rejects Provider deletion while models or Pricing remain", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [{ model_count: 2, pricing_rule_count: 3 }] });

    const response = await handleAdminResourceDelete(
      mutationRequest("/api/admin/providers/provider_1", "DELETE", {
        expectedDeleteRevision: before.delete_revision,
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "PROVIDER_DELETE_BLOCKED_BY_DEPENDENCIES",
        message: expect.stringContaining("仍有关联模型或定价"),
        details: { modelCount: 2, pricingRuleCount: 3 },
      },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
    expect(mocks.query).toHaveBeenCalledTimes(2);
  });

  it("requires the connected managed account to be safely disconnected before deletion", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ ...before, adapter_kind: "codex", managed_credential_id: "credential_1" }] })
      .mockResolvedValueOnce({ rows: [{ model_count: 0, pricing_rule_count: 0 }] });

    const response = await handleAdminResourceDelete(
      mutationRequest("/api/admin/providers/provider_1", "DELETE", {
        expectedDeleteRevision: before.delete_revision,
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_DELETE_ACCOUNT_CONNECTED" },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("blocks deletion when a legacy live credential is no longer referenced by the Provider", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [{ ...before, adapter_kind: "codex", managed_credential_id: null }] })
      .mockResolvedValueOnce({ rows: [{ model_count: 0, pricing_rule_count: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: "managed_orphan" }] });

    const response = await handleAdminResourceDelete(
      mutationRequest("/api/admin/providers/provider_1", "DELETE", {
        expectedDeleteRevision: before.delete_revision,
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROVIDER_DELETE_ACCOUNT_STATE_INCONSISTENT" },
    });
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("tombstones an empty Provider and excludes credential material from its audit", async () => {
    mocks.query
      .mockResolvedValueOnce({ rows: [before] })
      .mockResolvedValueOnce({ rows: [{ model_count: 0, pricing_rule_count: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{
          id: before.id,
          code: before.code,
          name: before.name,
          adapter_kind: before.adapter_kind,
          protocol: before.protocol,
          status: "deleted",
          auth_revision: 2,
          auth_epoch: 2,
          updated_at: "2026-09-04T00:30:00.000Z",
        }],
      });

    const response = await handleAdminResourceDelete(
      mutationRequest("/api/admin/providers/provider_1", "DELETE", {
        expectedDeleteRevision: before.delete_revision,
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { id: "provider_1", status: "deleted" },
    });
    expect(String(mocks.query.mock.calls[5]?.[0])).toContain("status = 'deleted'");
    const audit = mocks.audit.mock.calls[0]?.[1];
    expect(audit).toMatchObject({
      action: "delete",
      resourceType: "providers",
      resourceId: "provider_1",
      metadata: { deletionMode: "tombstone", modelCount: 0, pricingRuleCount: 0 },
    });
    expect(JSON.stringify(audit)).not.toContain("old-ciphertext");
    expect(JSON.stringify(audit)).not.toContain("old-iv");
    expect(JSON.stringify(audit)).not.toContain("old-tag");
  });

  it("rejects a stale or non-strict Provider deletion body before SQL", async () => {
    const response = await handleAdminResourceDelete(
      mutationRequest("/api/admin/providers/provider_1", "DELETE", {
        expectedDeleteRevision: before.delete_revision,
        cascade: true,
      }),
      "providers",
      "provider_1",
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ADMIN_INPUT_INVALID" },
    });
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
