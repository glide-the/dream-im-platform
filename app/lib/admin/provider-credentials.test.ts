// [Input] Provider PATCH candidates, current auth revisions, deterministic models, and mocked upstream results.
// [Output] Regression coverage for sensitive-change detection, fail-closed validation, and secret-safe auditing.
// [Pos] Unit contract for the Provider static-credential lifecycle preparation boundary.
// [Sync] 2026-09-04: cover ordinary PATCH, semantic equality, missing models, rejected credentials, and success.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { GatewayError } from "../gateway/errors";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  audit: vi.fn(),
  decrypt: vi.fn(() => "stored-credential"),
  validate: vi.fn(),
}));

vi.mock("../platform-db", () => ({
  withPlatformClient: async (
    callback: (client: { query: typeof mocks.query }) => unknown,
  ) => await callback({ query: mocks.query }),
  withPlatformTransaction: async (
    callback: (client: { query: typeof mocks.query }) => unknown,
  ) => await callback({ query: mocks.query }),
}));

vi.mock("../security/credential-encryption", () => ({
  decryptCredential: mocks.decrypt,
}));

vi.mock("./audit", () => ({
  recordAdminAuditOnClient: mocks.audit,
}));

vi.mock("./model-validation", () => ({
  validateUpstreamModel: mocks.validate,
}));

import { AdminError } from "./errors";
import { prepareProviderCredentialUpdate } from "./provider-credentials";

const providerRow = {
  id: "provider_1",
  code: "provider-one",
  protocol: "anthropic",
  base_url: "https://api.anthropic.com",
  status: "disabled",
  timeout_ms: 120_000,
  config: { authMode: "x-api-key", nested: { beta: true, alpha: 1 } },
  auth_revision: 3,
  api_key_ciphertext: "ciphertext",
  api_key_iv: "iv",
  api_key_tag: "tag",
  model_id: "model_1",
  model_code: "claude-fixture",
  upstream_model: "claude-fixture-upstream",
  request_headers: {},
};

function request(body: Record<string, unknown>) {
  return new Request("https://admin.test/api/admin/providers/provider_1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const identity = {
  id: "admin_1",
  email: "admin@example.com",
  roles: ["operator"],
  permissions: ["providers.write"],
  sessionId: "session_1",
};

describe("Provider credential update preparation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.query.mockResolvedValue({ rows: [providerRow] });
    mocks.validate.mockResolvedValue({
      status: "operational",
      usable: true,
      responseTimeMs: 12,
      httpStatus: 200,
      testedAt: "2026-09-04T00:00:00.000Z",
      message: "ok",
    });
  });

  it("does not validate an ordinary Provider PATCH", async () => {
    const result = await prepareProviderCredentialUpdate({
      providerId: providerRow.id,
      update: { timeoutMs: 90_000 },
      identity,
      request: request({ timeoutMs: 90_000 }),
      requestId: "admin_request_1",
    });

    expect(result).toEqual({ sensitive: false });
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it("treats normalized base URLs and reordered config keys as unchanged", async () => {
    const update = {
      baseUrl: "https://api.anthropic.com/",
      config: {
        nested: { alpha: 1, beta: true },
        authMode: "x-api-key",
      },
      expectedAuthRevision: 3,
    };
    const result = await prepareProviderCredentialUpdate({
      providerId: providerRow.id,
      update,
      identity,
      request: request(update),
      requestId: "admin_request_2",
    });

    expect(result).toEqual({ sensitive: false });
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it("does not validate model-catalog-only configuration changes", async () => {
    const update = {
      config: {
        authMode: "x-api-key",
        nested: { beta: true, alpha: 1 },
        modelCatalogMode: "manual",
        manualModel: "claude-new",
        modelsUrl: "https://api.anthropic.com/v1/models",
      },
      expectedAuthRevision: 3,
    };
    const result = await prepareProviderCredentialUpdate({
      providerId: providerRow.id,
      update,
      identity,
      request: request(update),
      requestId: "admin_request_catalog",
    });

    expect(result).toEqual({ sensitive: false });
    expect(mocks.validate).not.toHaveBeenCalled();
  });

  it.each([
    ["authMode", { authMode: "bearer", nested: { beta: true, alpha: 1 } }],
    [
      "outputTokenParam",
      {
        authMode: "x-api-key",
        outputTokenParam: "max_completion_tokens",
        nested: { beta: true, alpha: 1 },
      },
    ],
  ])("validates actual %s configuration changes", async (_field, config) => {
    const update = { config, expectedAuthRevision: 3 };
    const result = await prepareProviderCredentialUpdate({
      providerId: providerRow.id,
      update,
      identity,
      request: request(update),
      requestId: "admin_request_auth_config",
    });

    expect(result).toMatchObject({
      sensitive: true,
      expectedAuthRevision: 3,
    });
    expect(mocks.validate).toHaveBeenCalledTimes(1);
  });

  it("returns 409 and writes a secret-free audit when no validation model exists", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [{ ...providerRow, model_id: null, model_code: null, upstream_model: null }],
    });
    const secret = "candidate-secret-never-audit";
    const update = { apiKey: secret, expectedAuthRevision: 3 };

    await expect(
      prepareProviderCredentialUpdate({
        providerId: providerRow.id,
        update,
        identity,
        request: request(update),
        requestId: "admin_request_3",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_VALIDATION_MODEL_REQUIRED",
      status: 409,
    });
    expect(mocks.validate).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.audit.mock.calls[0]?.[1])).not.toContain(secret);
  });

  it("fails closed on a non-2xx result and never audits the candidate secret", async () => {
    mocks.validate.mockResolvedValueOnce({
      status: "failed",
      usable: false,
      responseTimeMs: 8,
      httpStatus: 401,
      testedAt: "2026-09-04T00:00:00.000Z",
      message: "rejected",
    });
    const secret = "candidate-secret-never-audit";
    const update = { apiKey: secret, expectedAuthRevision: 3 };

    await expect(
      prepareProviderCredentialUpdate({
        providerId: providerRow.id,
        update,
        identity,
        request: request(update),
        requestId: "admin_request_4",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_CREDENTIAL_VALIDATION_FAILED",
      status: 409,
    });
    expect(mocks.validate).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: secret,
        upstreamModel: providerRow.upstream_model,
      }),
    );
    expect(JSON.stringify(mocks.audit.mock.calls[0]?.[1])).not.toContain(secret);
  });

  it("returns a validation receipt for a credential-sensitive change", async () => {
    const update = {
      apiKey: "candidate-secret",
      expectedAuthRevision: 3,
    };
    const result = await prepareProviderCredentialUpdate({
      providerId: providerRow.id,
      update,
      identity,
      request: request(update),
      requestId: "admin_request_5",
    });

    expect(result).toEqual({
      sensitive: true,
      expectedAuthRevision: 3,
      validatedAt: new Date("2026-09-04T00:00:00.000Z"),
      validationModelCode: providerRow.model_code,
    });
    expect(String(mocks.query.mock.calls[0]?.[0])).toContain(
      "ORDER BY m.enabled DESC, m.code ASC, m.id ASC",
    );
  });

  it("maps a Gateway configuration error to a stable Admin error", async () => {
    mocks.validate.mockRejectedValueOnce(
      new GatewayError(
        "PROVIDER_AUTH_MODE_INVALID",
        "unsafe upstream detail",
        503,
        "configuration_error",
      ),
    );

    await expect(
      prepareProviderCredentialUpdate({
        providerId: providerRow.id,
        update: { config: { authMode: "query" }, expectedAuthRevision: 3 },
        identity,
        request: request({ config: { authMode: "query" }, expectedAuthRevision: 3 }),
        requestId: "admin_request_6",
      }),
    ).rejects.toMatchObject({
      code: "PROVIDER_AUTH_MODE_INVALID",
      message: "The Provider authentication configuration is invalid",
      status: 409,
    });
  });
});
