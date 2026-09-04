// [Input] Explicit fake registrations, deterministic clocks, and queued mock provider responses.
// [Output] Regression proof for readiness, auth lifecycle, resources, and safe account model catalogs.
// [Pos] Provider-free unit contract for the shared product registry; no real account or network is used.
// [Sync] 2026-09-04: cover product-specific model endpoints, compatibility, and isolated catalog byte budgets.

import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import type {
  CodexDeploymentConfigInput,
  GitHubCopilotDeploymentConfigInput,
  XaiDeploymentConfigInput,
} from "./config";
import {
  providerProductConfigsFromEnv,
  providerReadiness,
  registrationFingerprint,
  resolveProviderConfig,
} from "./config";
import { resolveProviderEndpoint } from "./endpoint-policy";
import { createProviderProductRegistry } from "./registry";
import { deviceFlowStateSchema, providerTokenBundleSchema } from "./schemas";
import type {
  CodexTokenBundle,
  DeviceFlowState,
  GitHubCopilotTokenBundle,
  XaiTokenBundle,
} from "./types";

const now = 1_800_000_000_000;

const codexKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const xaiKeys = generateKeyPairSync("ec", { namedCurve: "P-256" });
const codexJwk = {
  ...codexKeys.publicKey.export({ format: "jwk" }),
  kid: "codex-test-key",
  alg: "RS256",
  use: "sig",
};
const xaiJwk = {
  ...xaiKeys.publicKey.export({ format: "jwk" }),
  kid: "xai-test-key",
  alg: "ES256",
  use: "sig",
};

function jwt(
  product: "codex" | "xai",
  claims: Record<string, unknown>,
  overrides: { issuer?: string; audience?: string } = {},
) {
  const codex = product === "codex";
  return new SignJWT(claims)
    .setProtectedHeader({
      alg: codex ? "RS256" : "ES256",
      kid: codex ? codexJwk.kid : xaiJwk.kid,
    })
    .setIssuer(overrides.issuer ?? (codex ? "https://auth.openai.com" : "https://auth.x.ai"))
    .setAudience(overrides.audience ?? (codex ? "ink-owned-codex-client" : "ink-owned-xai-client"))
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(codex ? codexKeys.privateKey : xaiKeys.privateKey);
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function queuedFetch(responses: Response[]) {
  const mock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    const response = responses.shift();
    if (!response) throw new Error("unexpected fetch");
    return response;
  });
  return mock as typeof mock & typeof fetch;
}

const codexConfig: CodexDeploymentConfigInput = {
  product: "codex",
  clientId: "ink-owned-codex-client",
  scopes: ["openid", "offline_access"],
  userAgent: "ink-memory-codex/1.0",
  integrationId: "ink-memory",
  integrationVersion: "1.0",
};

const xaiConfig: XaiDeploymentConfigInput = {
  product: "xai",
  clientId: "ink-owned-xai-client",
  scopes: ["openid", "offline_access", "api:access"],
  userAgent: "ink-memory-xai/1.0",
  issuer: "https://auth.x.ai",
};

const githubConfig: GitHubCopilotDeploymentConfigInput = {
  product: "github_copilot",
  clientId: "ink-owned-github-app",
  scopes: ["read:user"],
  userAgent: "ink-memory-copilot/1.0",
  integrationProfile: {
    integrationId: "ink-memory-chat",
    editorVersion: "ink-admin/1.0",
    editorPluginVersion: "ink-copilot/1.0",
    apiVersion: "2026-03-10",
  },
};

const codexBundle: CodexTokenBundle = {
  product: "codex",
  accessToken: "codex-access-old",
  refreshToken: "codex-refresh-old",
  expiresAtMs: now + 60_000,
  grantedScopes: ["openid", "offline_access"],
  identity: { subject: "user-1", chatgptAccountId: "workspace-1" },
};

const xaiBundle: XaiTokenBundle = {
  product: "xai",
  accessToken: "xai-access-old",
  refreshToken: "xai-refresh-old",
  expiresAtMs: now + 60_000,
  grantedScopes: ["openid", "offline_access", "api:access"],
  identity: { subject: "xai-user-1" },
};

const githubBundle: GitHubCopilotTokenBundle = {
  product: "github_copilot",
  sourceAccessToken: "github-source-token",
  copilotAccessToken: "copilot-short-old",
  copilotExpiresAtMs: now + 60_000,
  grantedScopes: ["read:user"],
  identity: { numericId: 42, login: "octo" },
};

const xaiDiscovery = {
  issuer: "https://auth.x.ai",
  device_authorization_endpoint: "https://auth.x.ai/oauth2/device/code",
  token_endpoint: "https://auth.x.ai/oauth2/token",
  revocation_endpoint: "https://auth.x.ai/oauth2/revoke",
  jwks_uri: "https://auth.x.ai/.well-known/jwks.json",
  id_token_signing_alg_values_supported: ["ES256"],
};

describe("provider product configuration", () => {
  it("ships the same product-native Device registrations as the pinned cc-switch reference", () => {
    const configs = providerProductConfigsFromEnv({ NODE_ENV: "test" });

    expect(configs.codex).toMatchObject({
      clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
      scopes: ["openid", "profile", "email"],
      userAgent: "cc-switch-codex-oauth",
      integrationId: "codex_cli_rs",
      integrationVersion: "0.144.1",
      modelCatalogClientVersion: "3.20.1",
    });
    expect(configs.xai).toMatchObject({
      clientId: "b1a00492-073a-47ea-816f-4c329264a828",
      scopes: ["openid", "profile", "email", "offline_access", "grok-cli:access", "api:access"],
      userAgent: "cc-switch-xai-oauth",
      issuer: "https://auth.x.ai",
    });
    expect(configs.github_copilot).toMatchObject({
      clientId: "Iv1.b507a08c87ecfe98",
      scopes: ["read:user"],
      userAgent: "GitHubCopilotChat/0.38.2",
      integrationProfile: {
        integrationId: "vscode-chat",
        editorVersion: "vscode/1.110.1",
        editorPluginVersion: "copilot-chat/0.38.2",
        apiVersion: "2025-10-01",
      },
    });
    expect(providerReadiness("codex", configs.codex)).toMatchObject({ status: "ready" });
    expect(providerReadiness("xai", configs.xai)).toMatchObject({ status: "ready" });
    expect(providerReadiness("github_copilot", configs.github_copilot)).toMatchObject({
      status: "ready",
      capabilities: { remoteRevoke: false },
    });
    expect(resolveProviderConfig(configs.codex!)).toMatchObject({
      endpoints: { models: "https://chatgpt.com/backend-api/codex/models" },
    });
    expect(resolveProviderConfig(configs.xai!)).toMatchObject({
      endpoints: { models: "https://api.x.ai/v1/models" },
    });
    expect(resolveProviderConfig(configs.github_copilot!)).toMatchObject({
      endpoints: { models: "https://api.githubcopilot.com/models" },
    });
  });

  it("uses named environment values only as explicit product-default overrides", () => {
    const configs = providerProductConfigsFromEnv({
      NODE_ENV: "test",
      INK_PROVIDER_CODEX_CLIENT_ID: "deployment-codex-client",
      INK_PROVIDER_CODEX_SCOPES: "openid,offline_access",
      INK_PROVIDER_CODEX_MODELS_ENDPOINT: "https://chatgpt.com/custom/models",
      INK_PROVIDER_GITHUB_COPILOT_EDITOR_VERSION: "vscode/9.9.9",
    });

    expect(configs.codex).toMatchObject({
      clientId: "deployment-codex-client",
      scopes: ["openid", "offline_access"],
      integrationId: "codex_cli_rs",
      endpoints: { models: "https://chatgpt.com/custom/models" },
    });
    expect(configs.github_copilot?.integrationProfile).toMatchObject({
      editorVersion: "vscode/9.9.9",
      integrationId: "vscode-chat",
    });
  });

  it("fails closed when an explicit product override violates required scopes", () => {
    const configs = providerProductConfigsFromEnv({
      NODE_ENV: "test",
      INK_PROVIDER_XAI_SCOPES: "openid offline_access",
    });

    expect(providerReadiness("xai", configs.xai)).toMatchObject({
      status: "invalid_configuration",
      error: { code: "PROVIDER_SCOPE_INVALID" },
    });
  });

  it("fails closed without registrations and never attempts a request", async () => {
    const fetchMock = vi.fn();
    const registry = createProviderProductRegistry({
      configs: {},
      fetch: fetchMock as unknown as typeof fetch,
      now: () => now,
    });

    expect(registry.readiness("codex")).toMatchObject({
      status: "not_configured",
      oauthAppConfigured: false,
      registrationFingerprint: null,
    });
    expect(await registry.get("codex").startDevice()).toMatchObject({
      status: "failed",
      error: { code: "PROVIDER_NOT_CONFIGURED" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps GitHub device auth ready without a revoke secret", () => {
    const registry = createProviderProductRegistry({
      configs: { github_copilot: githubConfig },
      now: () => now,
    });
    expect(registry.readiness("github_copilot")).toMatchObject({
      status: "ready",
      oauthAppConfigured: true,
      integrationProfileConfigured: true,
      copilotAccessVerified: null,
      capabilities: { remoteRevoke: false },
    });
  });

  it("fingerprints registration and integration identity but not client secret", () => {
    const first = resolveProviderConfig({ ...githubConfig, clientSecret: "secret-a" });
    const second = resolveProviderConfig({ ...githubConfig, clientSecret: "secret-b" });
    const changed = resolveProviderConfig({
      ...githubConfig,
      integrationProfile: {
        ...githubConfig.integrationProfile,
        integrationId: "ink-memory-chat-v2",
      },
    });
    expect(registrationFingerprint(first)).toBe(registrationFingerprint(second));
    expect(registrationFingerprint(first)).not.toBe(registrationFingerprint(changed));
    expect(registrationFingerprint(first)).not.toContain(githubConfig.clientId!);
  });

  it("rejects non-HTTPS, non-443, and cross-product endpoint overrides", () => {
    for (const value of [
      "http://auth.openai.com/oauth/token",
      "https://auth.openai.com:8443/oauth/token",
      "https://api.x.ai/oauth/token",
      "https://user:password@auth.openai.com/oauth/token",
    ]) {
      expect(() =>
        resolveProviderEndpoint({ product: "codex", purpose: "token_exchange", value }),
      ).toThrowError(expect.objectContaining({ code: "PROVIDER_ENDPOINT_NOT_ALLOWED" }));
    }
    for (const value of [
      "https://api.openai.com/v1/models",
      "https://models.chatgpt.com/backend-api/codex/models",
      "https://chatgpt.com:8443/backend-api/codex/models",
    ]) {
      expect(() =>
        resolveProviderEndpoint({ product: "codex", purpose: "models", value }),
      ).toThrowError(expect.objectContaining({ code: "PROVIDER_ENDPOINT_NOT_ALLOWED" }));
    }
  });

  it("accepts only a same-host deployment endpoint override and required scopes", () => {
    expect(resolveProviderConfig({
      ...codexConfig,
      endpoints: { token: "https://auth.openai.com/custom/oauth/token" },
    })).toMatchObject({
      endpoints: { token: "https://auth.openai.com/custom/oauth/token" },
    });
    expect(() => resolveProviderConfig({
      ...xaiConfig,
      scopes: ["openid", "offline_access"],
    })).toThrowError(expect.objectContaining({ code: "PROVIDER_SCOPE_INVALID" }));
  });

  it("publishes strict parse-compatible device and bundle schemas", () => {
    expect(deviceFlowStateSchema.parse({
      product: "xai",
      deviceCode: "device-secret",
      userCode: "ABCD-EFGH",
      verificationUri: "https://auth.x.ai/activate",
      expiresInSeconds: 900,
      intervalSeconds: 5,
    }).product).toBe("xai");
    expect(providerTokenBundleSchema.parse(codexBundle).product).toBe("codex");
    expect(() => providerTokenBundleSchema.parse({
      ...codexBundle,
      unexpectedSecret: "no",
    })).toThrow();
  });
});

describe("CodexProviderAdapter", () => {
  it("uses the custom device request and authorization-code PKCE exchange", async () => {
    const idToken = await jwt("codex", {
      sub: "openai-user-7",
      "https://api.openai.com/auth": { chatgpt_account_id: "account-9" },
    });
    const fetchMock = queuedFetch([
      jsonResponse({ device_auth_id: "device-auth-secret", user_code: "CODE-1234" }),
      jsonResponse({ authorization_code: "auth-code", code_verifier: "pkce-verifier" }),
      jsonResponse({
        access_token: "access-secret",
        refresh_token: "refresh-secret",
        id_token: idToken,
        expires_in: 3600,
        scope: "offline_access openid",
      }),
      jsonResponse({ keys: [codexJwk] }),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { codex: codexConfig },
      fetch: fetchMock,
      now: () => now,
    }).get("codex");

    const started = await adapter.startDevice();
    expect(started.status).toBe("verification_required");
    if (started.status !== "verification_required") return;
    const connected = await adapter.pollDevice(started.flow);
    expect(connected).toMatchObject({
      status: "connected",
      bundle: {
        product: "codex",
        grantedScopes: ["offline_access", "openid"],
        identity: { subject: "openai-user-7", chatgptAccountId: "account-9" },
      },
    });

    const startInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(startInit.body))).toEqual({ client_id: codexConfig.clientId });
    const pollInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(pollInit.body))).toEqual({
      device_auth_id: "device-auth-secret",
      user_code: "CODE-1234",
    });
    const exchange = new URLSearchParams(String(
      (fetchMock.mock.calls[2]?.[1] as RequestInit).body,
    ));
    expect(Object.fromEntries(exchange)).toEqual({
      grant_type: "authorization_code",
      code: "auth-code",
      redirect_uri: "https://auth.openai.com/deviceauth/callback",
      client_id: codexConfig.clientId,
      code_verifier: "pkce-verifier",
    });
    expect(fetchMock.mock.calls.every(([, init]) =>
      init?.redirect === "error" && init.signal instanceof AbortSignal
    )).toBe(true);
  });

  it("maps custom pending/expired statuses without parsing secret bodies", async () => {
    const fetchMock = queuedFetch([
      new Response("device-auth-secret", { status: 404 }),
      new Response("device-auth-secret", { status: 410 }),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { codex: codexConfig },
      fetch: fetchMock,
    }).get("codex");
    const flow: DeviceFlowState = {
      product: "codex",
      deviceCode: "device-auth-secret",
      userCode: "CODE",
      verificationUri: "https://auth.openai.com/codex/device",
      expiresInSeconds: 900,
      intervalSeconds: 7,
    };
    expect(await adapter.pollDevice(flow)).toEqual({
      status: "pending",
      product: "codex",
      retryAfterSeconds: 7,
    });
    expect(await adapter.pollDevice(flow)).toEqual({ status: "expired", product: "codex" });
  });

  it("returns a complete rotated bundle and product-profile managed headers", async () => {
    const idToken = await jwt("codex", { sub: "user-1", chatgpt_account_id: "workspace-1" });
    const fetchMock = queuedFetch([
      jsonResponse({
        access_token: "codex-access-new",
        refresh_token: "codex-refresh-new",
        id_token: idToken,
        expires_in: 600,
      }),
      jsonResponse({ keys: [codexJwk] }),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { codex: codexConfig },
      fetch: fetchMock,
      now: () => now,
    }).get("codex");
    const refreshed = await adapter.refreshOrRenew(codexBundle);
    expect(refreshed).toMatchObject({
      status: "ready",
      rotated: true,
      bundle: { refreshToken: "codex-refresh-new", expiresAtMs: now + 600_000 },
    });
    const resource = adapter.getResourceContract();
    expect(resource).toMatchObject({
      status: "ready",
      contract: {
        dialect: "openai_responses",
        url: "https://chatgpt.com/backend-api/codex/responses",
      },
    });
    if (resource.status !== "ready") return;
    const built = resource.contract.buildHeaders(codexBundle);
    if (built.status !== "ready") throw new Error("headers not ready");
    expect(built.headers.get("originator")).toBe("ink-memory");
    expect(built.headers.get("version")).toBe("1.0");
    expect(built.headers.get("chatgpt-account-id")).toBe("workspace-1");
  });

  it("fetches the exact ChatGPT models endpoint and normalizes every supported shape", async () => {
    const responses = [
      { data: [{ id: "gpt-data", owned_by: "openai", display_name: "GPT Data" }] },
      { models: [{ slug: "gpt-models", display_name: "GPT Models" }] },
      { items: ["gpt-items"] },
      [{ model: "gpt-array", provider: "OpenAI" }],
      { models: { "gpt-map": { display_name: "GPT Map", owner: "OpenAI" } } },
      { data: [{ id: "gpt-duplicate" }, { model: "gpt-duplicate" }] },
    ];
    const fetchMock = queuedFetch(responses.map((value) => jsonResponse(value)));
    const adapter = createProviderProductRegistry({
      configs: { codex: codexConfig },
      fetch: fetchMock,
    }).get("codex");

    const catalogs = [];
    for (const _response of responses) catalogs.push(await adapter.fetchModelCatalog(codexBundle));

    expect(catalogs.map((result) => result.status === "ready"
      ? result.models.map((model) => model.id)
      : [])).toEqual([
      ["gpt-data"],
      ["gpt-models"],
      ["gpt-items"],
      ["gpt-array"],
      ["gpt-map"],
      ["gpt-duplicate"],
    ]);
    expect(catalogs[0]).toMatchObject({
      status: "ready",
      endpoint: "https://chatgpt.com/backend-api/codex/models",
      models: [{
        id: "gpt-data",
        displayName: "GPT Data",
        vendor: "openai",
        upstreamDialect: "openai_responses",
        gatewayCompatible: true,
        capabilities: [],
      }],
    });
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(`${requestUrl.origin}${requestUrl.pathname}`).toBe(
      "https://chatgpt.com/backend-api/codex/models",
    );
    expect(requestUrl.searchParams.get("client_version")).toBe("3.20.1");
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(Object.fromEntries(headers.entries())).toEqual({
      authorization: "Bearer codex-access-old",
      "chatgpt-account-id": "workspace-1",
      originator: "cc-switch",
    });
  });

  it("accepts a Codex catalog above the sensitive OAuth response budget", async () => {
    const adapter = createProviderProductRegistry({
      configs: { codex: codexConfig },
      fetch: queuedFetch([jsonResponse({
        data: [{ id: "gpt-large-catalog", description: "x".repeat(70 * 1024) }],
      })]),
    }).get("codex");

    expect(await adapter.fetchModelCatalog(codexBundle)).toMatchObject({
      status: "ready",
      models: [{ id: "gpt-large-catalog" }],
    });
  });

  it("hands off a newly issued grant for cleanup when required scopes are missing", async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ authorization_code: "auth-code", code_verifier: "pkce-verifier" }),
      jsonResponse({
        access_token: "codex-access-rejected",
        refresh_token: "codex-refresh-rejected",
        id_token: "not-reached",
        expires_in: 600,
        scope: "openid",
      }),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { codex: codexConfig },
      fetch: fetchMock,
    }).get("codex");
    const result = await adapter.pollDevice({
      product: "codex",
      deviceCode: "device",
      userCode: "code",
      verificationUri: "https://auth.openai.com/codex/device",
      expiresInSeconds: 900,
      intervalSeconds: 5,
    });
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "PROVIDER_REQUIRED_SCOPE_MISSING" },
    });
    if (result.status !== "failed") return;
    expect(result.revocationHandoff?.unwrap()).toEqual({
      product: "codex",
      refreshToken: "codex-refresh-rejected",
    });
    expect(JSON.stringify(result)).not.toContain("codex-refresh-rejected");
  });
});

describe("XaiProviderAdapter", () => {
  it("starts RFC 8628 with the deployment client and scopes", async () => {
    const fetchMock = queuedFetch([
      jsonResponse(xaiDiscovery),
      jsonResponse({
        device_code: "xai-device-secret",
        user_code: "XAI-CODE",
        verification_uri: "https://auth.x.ai/activate",
        verification_uri_complete: "https://auth.x.ai/activate?code=XAI-CODE",
        expires_in: 900,
        interval: "5",
      }),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { xai: xaiConfig },
      fetch: fetchMock,
    }).get("xai");
    expect(await adapter.startDevice()).toMatchObject({
      status: "verification_required",
      flow: { intervalSeconds: 5, verificationUriComplete: expect.stringContaining("XAI-CODE") },
    });
    const form = new URLSearchParams(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body));
    expect(Object.fromEntries(form)).toEqual({
      client_id: xaiConfig.clientId,
      scope: "openid offline_access api:access",
    });
  });

  it("requires an exact discovery issuer", async () => {
    const adapter = createProviderProductRegistry({
      configs: { xai: xaiConfig },
      fetch: queuedFetch([jsonResponse({ ...xaiDiscovery, issuer: "https://auth.x.ai/" })]),
    }).get("xai");
    expect(await adapter.startDevice()).toMatchObject({
      status: "failed",
      error: { code: "XAI_DISCOVERY_ISSUER_MISMATCH" },
    });
  });

  it("maps RFC 8628 pending, slow_down +5, denied, and expired", async () => {
    const fetchMock = queuedFetch([
      jsonResponse(xaiDiscovery),
      jsonResponse({ error: "authorization_pending" }, 400),
      jsonResponse({ error: "slow_down" }, 400),
      jsonResponse({ error: "access_denied" }, 400),
      jsonResponse({ error: "expired_token" }, 400),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { xai: xaiConfig },
      fetch: fetchMock,
    }).get("xai");
    const flow: DeviceFlowState = {
      product: "xai",
      deviceCode: "xai-device-secret",
      userCode: "XAI-CODE",
      verificationUri: "https://auth.x.ai/activate",
      expiresInSeconds: 900,
      intervalSeconds: 5,
    };
    expect(await adapter.pollDevice(flow)).toMatchObject({ status: "pending", retryAfterSeconds: 5 });
    expect(await adapter.pollDevice(flow)).toMatchObject({ status: "slow_down", retryAfterSeconds: 10 });
    expect(await adapter.pollDevice(flow)).toMatchObject({ status: "denied" });
    expect(await adapter.pollDevice(flow)).toMatchObject({ status: "expired" });
  });

  it("rotates refresh tokens while preserving the bound sub", async () => {
    const fetchMock = queuedFetch([
      jsonResponse(xaiDiscovery),
      jsonResponse({
        access_token: "xai-access-new",
        refresh_token: "xai-refresh-new",
        id_token: await jwt("xai", { sub: "xai-user-1" }),
        expires_in: 7200,
      }),
      jsonResponse({ keys: [xaiJwk] }),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { xai: xaiConfig },
      fetch: fetchMock,
      now: () => now,
    }).get("xai");
    expect(await adapter.refreshOrRenew(xaiBundle)).toMatchObject({
      status: "ready",
      rotated: true,
      bundle: {
        refreshToken: "xai-refresh-new",
        identity: { subject: "xai-user-1" },
      },
    });
  });

  it("returns a non-serializable cleanup handoff when rotated identity changes", async () => {
    const fetchMock = queuedFetch([
      jsonResponse(xaiDiscovery),
      jsonResponse({
        access_token: "xai-access-rejected",
        refresh_token: "xai-refresh-rejected",
        id_token: await jwt("xai", { sub: "different-subject" }),
        expires_in: 7200,
      }),
      jsonResponse({ keys: [xaiJwk] }),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { xai: xaiConfig },
      fetch: fetchMock,
      now: () => now,
    }).get("xai");
    const result = await adapter.refreshOrRenew(xaiBundle);
    expect(result).toMatchObject({
      status: "reauthorization_required",
      reason: "identity_changed",
    });
    if (result.status !== "reauthorization_required") return;
    expect(result.revocationHandoff?.unwrap()).toEqual({
      product: "xai",
      refreshToken: "xai-refresh-rejected",
    });
    expect(JSON.stringify(result)).not.toContain("xai-refresh-rejected");
  });

  it("fetches strict /v1/models data with only the account bearer token", async () => {
    const fetchMock = queuedFetch([jsonResponse({
      data: [
        { id: "grok-z", owned_by: "xAI", secret: "not-projected" },
        { id: "grok-a" },
      ],
    })]);
    const adapter = createProviderProductRegistry({
      configs: { xai: xaiConfig },
      fetch: fetchMock,
    }).get("xai");

    const result = await adapter.fetchModelCatalog(xaiBundle);
    expect(result).toEqual({
      status: "ready",
      product: "xai",
      endpoint: "https://api.x.ai/v1/models",
      models: [
        {
          id: "grok-a",
          displayName: "grok-a",
          vendor: "xAI",
          upstreamDialect: "openai_responses",
          gatewayCompatible: true,
          capabilities: [],
        },
        {
          id: "grok-z",
          displayName: "grok-z",
          vendor: "xAI",
          upstreamDialect: "openai_responses",
          gatewayCompatible: true,
          capabilities: [],
        },
      ],
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.x.ai/v1/models");
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(Object.fromEntries(headers.entries())).toEqual({
      authorization: "Bearer xai-access-old",
    });
    expect(JSON.stringify(result)).not.toContain("not-projected");
  });

  it("accepts an xAI catalog above the sensitive OAuth response budget", async () => {
    const adapter = createProviderProductRegistry({
      configs: { xai: xaiConfig },
      fetch: queuedFetch([jsonResponse({
        data: [{ id: "grok-large-catalog", description: "x".repeat(70 * 1024) }],
      })]),
    }).get("xai");

    expect(await adapter.fetchModelCatalog(xaiBundle)).toMatchObject({
      status: "ready",
      models: [{ id: "grok-large-catalog" }],
    });
  });

  it("rejects an xAI catalog without the strict data envelope", async () => {
    const adapter = createProviderProductRegistry({
      configs: { xai: xaiConfig },
      fetch: queuedFetch([jsonResponse({ models: [{ id: "grok" }] })]),
    }).get("xai");
    expect(await adapter.fetchModelCatalog(xaiBundle)).toMatchObject({
      status: "failed",
      error: { code: "XAI_MODEL_CATALOG_INVALID", category: "protocol" },
    });
  });
});

describe("GitHubCopilotProviderAdapter", () => {
  const flow: DeviceFlowState = {
    product: "github_copilot",
    deviceCode: "github-device-secret",
    userCode: "GITHUB-CODE",
    verificationUri: "https://github.com/login/device",
    expiresInSeconds: 900,
    intervalSeconds: 5,
  };

  it("starts Device Flow with the deployment OAuth App and no client secret", async () => {
    const fetchMock = queuedFetch([jsonResponse({
      device_code: "github-device-secret",
      user_code: "GITHUB-CODE",
      verification_uri: "https://github.com/login/device",
      expires_in: 900,
      interval: 5,
    })]);
    const adapter = createProviderProductRegistry({
      configs: { github_copilot: githubConfig },
      fetch: fetchMock,
    }).get("github_copilot");
    expect(await adapter.startDevice()).toMatchObject({ status: "verification_required" });
    const body = String((fetchMock.mock.calls[0]?.[1] as RequestInit).body);
    expect(Object.fromEntries(new URLSearchParams(body))).toEqual({
      client_id: githubConfig.clientId,
      scope: "read:user",
    });
    expect(body).not.toContain("client_secret");
  });

  it("does not report connected when OAuth succeeds but Copilot entitlement fails", async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ access_token: "github-source-secret", token_type: "bearer" }),
      jsonResponse({ id: 42, login: "octo" }),
      jsonResponse({ message: "source secret must not leak" }, 403),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { github_copilot: githubConfig },
      fetch: fetchMock,
    }).get("github_copilot");
    const result = await adapter.pollDevice(flow);
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "COPILOT_ENTITLEMENT_REQUIRED", category: "entitlement" },
    });
    if (result.status !== "failed") return;
    expect(result.revocationHandoff?.unwrap()).toEqual({
      product: "github_copilot",
      sourceAccessToken: "github-source-secret",
    });
    expect(JSON.stringify(result)).not.toContain("github-source-secret");
    expect(JSON.stringify(result)).not.toContain("github-device-secret");
  });

  it("maps GitHub Device Flow contract errors without returning descriptions", async () => {
    const secretDescription = "github-device-secret should never escape";
    const adapter = createProviderProductRegistry({
      configs: { github_copilot: githubConfig },
      fetch: queuedFetch([jsonResponse({
        error: "incorrect_client_credentials",
        error_description: secretDescription,
      })]),
    }).get("github_copilot");
    const result = await adapter.pollDevice(flow);
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "GITHUB_CLIENT_REGISTRATION_REJECTED", category: "configuration" },
    });
    expect(JSON.stringify(result)).not.toContain(secretDescription);
  });

  it("connects only after numeric identity and short Copilot token exchange", async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ access_token: "github-source-secret", token_type: "bearer", scope: "read:user" }),
      jsonResponse({ id: 42, login: "octo" }),
      jsonResponse({ token: "copilot-short-secret", expires_at: 1_800_000_600 }),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { github_copilot: githubConfig },
      fetch: fetchMock,
      now: () => now,
    }).get("github_copilot");
    expect(await adapter.pollDevice(flow)).toMatchObject({
      status: "connected",
      bundle: {
        sourceAccessToken: "github-source-secret",
        copilotAccessToken: "copilot-short-secret",
        copilotExpiresAtMs: 1_800_000_600_000,
        grantedScopes: ["read:user"],
        identity: { numericId: 42, login: "octo" },
      },
    });
    const pollForm = new URLSearchParams(String(
      (fetchMock.mock.calls[0]?.[1] as RequestInit).body,
    ));
    expect(Object.fromEntries(pollForm)).toEqual({
      client_id: githubConfig.clientId,
      device_code: "github-device-secret",
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    expect((fetchMock.mock.calls[2]?.[1] as RequestInit).headers).toMatchObject({
      "copilot-integration-id": "ink-memory-chat",
      "editor-version": "ink-admin/1.0",
    });
  });

  it("renews the short token and publishes only the configured Chat profile", async () => {
    const fetchMock = queuedFetch([
      jsonResponse({ id: 42, login: "octo" }),
      jsonResponse({ token: "copilot-short-new", expires_at: 1_800_000_900 }),
    ]);
    const adapter = createProviderProductRegistry({
      configs: { github_copilot: githubConfig },
      fetch: fetchMock,
      now: () => now,
    }).get("github_copilot");
    expect(await adapter.refreshOrRenew(githubBundle)).toMatchObject({
      status: "ready",
      rotated: true,
      bundle: { copilotAccessToken: "copilot-short-new" },
    });
    const resource = adapter.getResourceContract();
    expect(resource).toMatchObject({
      status: "ready",
      contract: {
        dialect: "openai_chat",
        url: "https://api.githubcopilot.com/chat/completions",
      },
    });
    if (resource.status !== "ready") return;
    const built = resource.contract.buildHeaders(githubBundle);
    if (built.status !== "ready") throw new Error("headers not ready");
    expect(built.headers.get("copilot-integration-id")).toBe("ink-memory-chat");
    expect(built.headers.get("editor-version")).toBe("ink-admin/1.0");
    expect(built.headers.get("authorization")).toBe("Bearer copilot-short-old");
  });

  it("filters the Copilot picker and marks OpenAI Responses models incompatible", async () => {
    const fetchMock = queuedFetch([jsonResponse({
      data: [
        {
          id: "gpt-5.4",
          name: "GPT-5.4",
          vendor: "OpenAI",
          model_picker_enabled: true,
          secret: "not-projected",
        },
        {
          id: "claude-sonnet-4.5",
          name: "Claude Sonnet 4.5",
          vendor: "Anthropic",
          model_picker_enabled: true,
        },
        {
          id: "hidden-model",
          name: "Hidden",
          vendor: "Other",
          model_picker_enabled: false,
        },
      ],
    })]);
    const adapter = createProviderProductRegistry({
      configs: { github_copilot: githubConfig },
      fetch: fetchMock,
    }).get("github_copilot");

    const result = await adapter.fetchModelCatalog(githubBundle);
    expect(result).toEqual({
      status: "ready",
      product: "github_copilot",
      endpoint: "https://api.githubcopilot.com/models",
      models: [
        {
          id: "gpt-5.4",
          displayName: "GPT-5.4",
          vendor: "OpenAI",
          upstreamDialect: "openai_responses",
          gatewayCompatible: false,
          capabilities: [],
        },
        {
          id: "claude-sonnet-4.5",
          displayName: "Claude Sonnet 4.5",
          vendor: "Anthropic",
          upstreamDialect: "openai_chat",
          gatewayCompatible: true,
          capabilities: [],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("hidden-model");
    expect(JSON.stringify(result)).not.toContain("not-projected");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.githubcopilot.com/models");
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(Object.fromEntries(headers.entries())).toEqual({
      authorization: "Bearer copilot-short-old",
      "content-type": "application/json",
      "copilot-integration-id": "ink-memory-chat",
      "editor-plugin-version": "ink-copilot/1.0",
      "editor-version": "ink-admin/1.0",
      "user-agent": "ink-memory-copilot/1.0",
      "x-github-api-version": "2026-03-10",
    });
  });

  it("accepts a Copilot catalog above the sensitive OAuth response budget", async () => {
    const adapter = createProviderProductRegistry({
      configs: { github_copilot: githubConfig },
      fetch: queuedFetch([jsonResponse({
        data: [{
          id: "copilot-large-catalog",
          name: "Copilot Large Catalog",
          vendor: "Anthropic",
          model_picker_enabled: true,
          description: "x".repeat(70 * 1024),
        }],
      })]),
    }).get("github_copilot");

    expect(await adapter.fetchModelCatalog(githubBundle)).toMatchObject({
      status: "ready",
      models: [{ id: "copilot-large-catalog" }],
    });
  });

  it("reports revoke unsupported without secret and uses the official app contract with one", async () => {
    const noSecret = createProviderProductRegistry({
      configs: { github_copilot: githubConfig },
      fetch: vi.fn() as unknown as typeof fetch,
    }).get("github_copilot");
    expect(await noSecret.revoke(githubBundle)).toEqual({
      status: "unsupported",
      product: "github_copilot",
      reason: "remote_revoke_not_configured",
    });

    const fetchMock = queuedFetch([new Response(null, { status: 204 })]);
    const withSecret = createProviderProductRegistry({
      configs: {
        github_copilot: { ...githubConfig, clientSecret: "owned-app-secret" },
      },
      fetch: fetchMock,
    }).get("github_copilot");
    expect(await withSecret.revoke(githubBundle)).toMatchObject({ status: "revoked", remote: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.github.com/applications/ink-owned-github-app/token",
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe("DELETE");
    expect(JSON.parse(String(init.body))).toEqual({ access_token: "github-source-token" });
  });
});
