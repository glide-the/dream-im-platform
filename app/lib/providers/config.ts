// [Input] Product-owned OAuth defaults plus optional named process environment overrides.
// [Output] Validated provider product config, named resource/model endpoints, readiness, and fingerprint.
// [Pos] Composition boundary mirroring the pinned cc-switch product integrations without exposing secrets.
// [Sync] 2026-09-04: add separately validated per-product model catalog endpoints.

import { createHash } from "node:crypto";
import { ProviderProtocolError } from "./errors";
import { resolveProviderEndpoint } from "./endpoint-policy";
import type { ProviderProductKind, ProviderReadiness } from "./types";

export type ProviderEndpointOverrides = Readonly<Partial<{
  deviceAuthorization: string;
  devicePoll: string;
  token: string;
  verification: string;
  redirectUri: string;
  discovery: string;
  jwks: string;
  identity: string;
  copilotToken: string;
  revoke: string;
  resource: string;
  models: string;
}>>;

type BaseDeploymentConfigInput = Readonly<{
  clientId?: string;
  scopes?: readonly string[];
  userAgent?: string;
  endpoints?: ProviderEndpointOverrides;
}>;

export type CodexDeploymentConfigInput = BaseDeploymentConfigInput & Readonly<{
  product: "codex";
  integrationId?: string;
  integrationVersion?: string;
  modelCatalogClientVersion?: string;
}>;

export type XaiDeploymentConfigInput = BaseDeploymentConfigInput & Readonly<{
  product: "xai";
  issuer?: string;
}>;

export type GitHubCopilotDeploymentConfigInput = BaseDeploymentConfigInput & Readonly<{
  product: "github_copilot";
  clientSecret?: string;
  integrationProfile?: Readonly<Partial<{
    integrationId: string;
    editorVersion: string;
    editorPluginVersion: string;
    apiVersion: string;
  }>>;
}>;

export type ProviderDeploymentConfigInput =
  | CodexDeploymentConfigInput
  | XaiDeploymentConfigInput
  | GitHubCopilotDeploymentConfigInput;

export type ProviderProductConfigs = Readonly<
  Partial<{
    codex: CodexDeploymentConfigInput;
    xai: XaiDeploymentConfigInput;
    github_copilot: GitHubCopilotDeploymentConfigInput;
  }>
>;

export type ResolvedCodexConfig = Readonly<{
  product: "codex";
  clientId: string;
  scopes: readonly string[];
  userAgent: string;
  integrationId: string;
  integrationVersion: string;
  modelCatalogClientVersion: string;
  endpoints: Readonly<{
    deviceAuthorization: string;
    devicePoll: string;
    token: string;
    verification: string;
    redirectUri: string;
    revoke: string;
    resource: string;
    models: string;
    jwks: string;
  }>;
}>;

export type ResolvedXaiConfig = Readonly<{
  product: "xai";
  clientId: string;
  scopes: readonly string[];
  userAgent: string;
  issuer: string;
  endpoints: Readonly<{ discovery: string; resource: string; models: string }>;
}>;

export type ResolvedGitHubCopilotConfig = Readonly<{
  product: "github_copilot";
  clientId: string;
  clientSecret: string;
  scopes: readonly string[];
  userAgent: string;
  integrationProfile: Readonly<{
    integrationId: string;
    editorVersion: string;
    editorPluginVersion: string;
    apiVersion: string;
  }>;
  endpoints: Readonly<{
    deviceAuthorization: string;
    token: string;
    identity: string;
    copilotToken: string;
    revoke: string;
    resource: string;
    models: string;
  }>;
}>;

export type ResolvedProviderConfig =
  | ResolvedCodexConfig
  | ResolvedXaiConfig
  | ResolvedGitHubCopilotConfig;

const DEFAULT_ENDPOINTS = {
  codex: {
    deviceAuthorization: "https://auth.openai.com/api/accounts/deviceauth/usercode",
    devicePoll: "https://auth.openai.com/api/accounts/deviceauth/token",
    token: "https://auth.openai.com/oauth/token",
    verification: "https://auth.openai.com/codex/device",
    redirectUri: "https://auth.openai.com/deviceauth/callback",
    revoke: "https://auth.openai.com/oauth/revoke",
    resource: "https://chatgpt.com/backend-api/codex/responses",
    models: "https://chatgpt.com/backend-api/codex/models",
    jwks: "https://auth.openai.com/.well-known/jwks.json",
  },
  xai: {
    discovery: "https://auth.x.ai/.well-known/openid-configuration",
    resource: "https://api.x.ai/v1/responses",
    models: "https://api.x.ai/v1/models",
  },
  github_copilot: {
    deviceAuthorization: "https://github.com/login/device/code",
    token: "https://github.com/login/oauth/access_token",
    identity: "https://api.github.com/user",
    copilotToken: "https://api.github.com/copilot_internal/v2/token",
    revoke: "https://api.github.com/applications",
    resource: "https://api.githubcopilot.com/chat/completions",
    models: "https://api.githubcopilot.com/models",
  },
} as const;

/**
 * Public native-client metadata mirrored from cc-switch HEAD
 * 92d529168560bdec4ca1b429b50a203c5fc8a87e. These values identify the
 * upstream product integration; none is a client secret. Named environment
 * values remain supported as explicit forward-compatible overrides.
 */
const DEFAULT_PRODUCT_CONFIG = {
  codex: {
    clientId: "app_EMoamEEZ73f0CkXaXp7hrann",
    scopes: ["openid", "profile", "email"],
    userAgent: "cc-switch-codex-oauth",
    integrationId: "codex_cli_rs",
    integrationVersion: "0.144.1",
    modelCatalogClientVersion: "3.20.1",
  },
  xai: {
    clientId: "b1a00492-073a-47ea-816f-4c329264a828",
    scopes: ["openid", "profile", "email", "offline_access", "grok-cli:access", "api:access"],
    userAgent: "cc-switch-xai-oauth",
    issuer: "https://auth.x.ai",
  },
  github_copilot: {
    clientId: "Iv1.b507a08c87ecfe98",
    scopes: ["read:user"],
    userAgent: "GitHubCopilotChat/0.38.2",
    integrationProfile: {
      integrationId: "vscode-chat",
      editorVersion: "vscode/1.110.1",
      editorPluginVersion: "copilot-chat/0.38.2",
      apiVersion: "2025-10-01",
    },
  },
} as const;

function nonEmpty(value: string | undefined) {
  return value?.trim() || undefined;
}

function scopes(value: readonly string[] | undefined) {
  return value?.map((item) => item.trim()).filter(Boolean) ?? [];
}

function assertRequiredScopes(
  product: ProviderProductKind,
  configured: readonly string[],
) {
  const required = product === "codex"
    ? ["openid"]
    : product === "xai"
      ? ["openid", "offline_access", "api:access"]
      : ["read:user"];
  if (required.some((scope) => !configured.includes(scope))) {
    throw new ProviderProtocolError({
      code: "PROVIDER_SCOPE_INVALID",
      category: "configuration",
      message: "The provider registration is missing a required product scope",
    });
  }
}

function configMissingFields(input: ProviderDeploymentConfigInput | undefined): string[] {
  if (!input) return ["deploymentConfig"];
  const missing: string[] = [];
  if (!nonEmpty(input.clientId)) missing.push("clientId");
  if (scopes(input.scopes).length === 0) missing.push("scopes");
  if (!nonEmpty(input.userAgent)) missing.push("userAgent");
  if (input.product === "codex") {
    if (!nonEmpty(input.integrationId)) missing.push("integrationId");
    if (!nonEmpty(input.integrationVersion)) missing.push("integrationVersion");
  }
  if (input.product === "xai" && !nonEmpty(input.issuer)) missing.push("issuer");
  if (input.product === "github_copilot") {
    if (!nonEmpty(input.integrationProfile?.integrationId)) missing.push("integrationProfile.integrationId");
    if (!nonEmpty(input.integrationProfile?.editorVersion)) missing.push("integrationProfile.editorVersion");
    if (!nonEmpty(input.integrationProfile?.editorPluginVersion)) missing.push("integrationProfile.editorPluginVersion");
    if (!nonEmpty(input.integrationProfile?.apiVersion)) missing.push("integrationProfile.apiVersion");
  }
  return missing;
}

function hasIntegrationProfile(
  product: ProviderProductKind,
  input: ProviderDeploymentConfigInput | undefined,
): boolean | null {
  if (product === "xai") return null;
  if (!input || input.product !== product) return false;
  if (input.product === "codex") {
    return Boolean(
      nonEmpty(input.integrationId) &&
      nonEmpty(input.integrationVersion) &&
      nonEmpty(input.userAgent),
    );
  }
  return Boolean(
    nonEmpty(input.integrationProfile?.integrationId) &&
    nonEmpty(input.integrationProfile?.editorVersion) &&
    nonEmpty(input.integrationProfile?.editorPluginVersion) &&
    nonEmpty(input.integrationProfile?.apiVersion) &&
    nonEmpty(input.userAgent),
  );
}

export function registrationFingerprint(input: ResolvedProviderConfig): string {
  const canonicalScopes = [...input.scopes].map((scope) => scope.trim()).sort();
  const identity = input.product === "codex"
    ? [
        input.product,
        input.clientId.trim(),
        canonicalScopes,
        input.integrationId,
        input.integrationVersion,
      ]
    : input.product === "xai"
      ? [input.product, input.issuer, input.clientId.trim(), canonicalScopes]
      : [
          input.product,
          input.clientId.trim(),
          canonicalScopes,
          input.userAgent,
          input.integrationProfile.integrationId,
          input.integrationProfile.editorVersion,
          input.integrationProfile.editorPluginVersion,
          input.integrationProfile.apiVersion,
        ];
  return `sha256:${createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 20)}`;
}

export function providerReadiness(
  product: ProviderProductKind,
  input: ProviderDeploymentConfigInput | undefined,
): ProviderReadiness {
  if (input && input.product !== product) {
    return {
      status: "invalid_configuration",
      product,
      registrationFingerprint: null,
      oauthAppConfigured: false,
      integrationProfileConfigured: hasIntegrationProfile(product, input),
      copilotAccessVerified: null,
      missingFields: [],
      error: {
        code: "PROVIDER_PRODUCT_MISMATCH",
        category: "configuration",
        message: "The provider deployment configuration has the wrong product kind",
        retryable: false,
      },
    };
  }
  const missingFields = configMissingFields(input);
  if (missingFields.length > 0) {
    const oauthAppConfigured = Boolean(input && nonEmpty(input.clientId));
    return {
      status: "not_configured",
      product,
      registrationFingerprint: null,
      oauthAppConfigured,
      integrationProfileConfigured: hasIntegrationProfile(product, input),
      copilotAccessVerified: null,
      missingFields,
      error: {
        code: "PROVIDER_NOT_CONFIGURED",
        category: "configuration",
        message: "The provider product registration is not configured",
        retryable: false,
      },
    };
  }
  try {
    const resolved = resolveProviderConfig(input as ProviderDeploymentConfigInput);
    return {
      status: "ready",
      product,
      registrationFingerprint: registrationFingerprint(resolved),
      oauthAppConfigured: true,
      integrationProfileConfigured: product === "xai" ? null : true,
      copilotAccessVerified: null,
      capabilities: {
        deviceAuthorization: true,
        refreshOrRenew: true,
        remoteRevoke:
          resolved.product !== "github_copilot" || resolved.clientSecret.length > 0,
        modelResource: true,
      },
    };
  } catch (error) {
    const protocolError = error instanceof ProviderProtocolError ? error : undefined;
    return {
      status: "invalid_configuration",
      product,
      registrationFingerprint: null,
      oauthAppConfigured: Boolean(input && nonEmpty(input.clientId)),
      integrationProfileConfigured: hasIntegrationProfile(product, input),
      copilotAccessVerified: null,
      missingFields: [],
      error: protocolError?.toSafeError() ?? {
        code: "PROVIDER_CONFIGURATION_INVALID",
        category: "configuration",
        message: "The provider product configuration is invalid",
        retryable: false,
      },
    };
  }
}

export function resolveProviderConfig(input: ProviderDeploymentConfigInput): ResolvedProviderConfig {
  const missing = configMissingFields(input);
  if (missing.length > 0) {
    throw new ProviderProtocolError({
      code: "PROVIDER_NOT_CONFIGURED",
      category: "configuration",
      message: "The provider product registration is not configured",
    });
  }
  const clientId = nonEmpty(input.clientId)!;
  const resolvedScopes = scopes(input.scopes);
  assertRequiredScopes(input.product, resolvedScopes);
  const userAgent = nonEmpty(input.userAgent)!;
  const override = input.endpoints ?? {};

  const assertHeaderValue = (name: string, value: string) => {
    try {
      new Headers({ [name]: value });
    } catch {
      throw new ProviderProtocolError({
        code: "PROVIDER_HEADER_PROFILE_INVALID",
        category: "configuration",
        message: "The provider integration profile contains an invalid header value",
      });
    }
  };
  assertHeaderValue("user-agent", userAgent);

  if (input.product === "codex") {
    assertHeaderValue("originator", nonEmpty(input.integrationId)!);
    assertHeaderValue("version", nonEmpty(input.integrationVersion)!);
    const endpoint = (key: keyof typeof DEFAULT_ENDPOINTS.codex, purpose: Parameters<typeof resolveProviderEndpoint>[0]["purpose"]) =>
      resolveProviderEndpoint({
        product: input.product,
        purpose,
        value: override[key] ?? DEFAULT_ENDPOINTS.codex[key],
      });
    return {
      product: input.product,
      clientId,
      scopes: resolvedScopes,
      userAgent,
      integrationId: nonEmpty(input.integrationId)!,
      integrationVersion: nonEmpty(input.integrationVersion)!,
      modelCatalogClientVersion:
        nonEmpty(input.modelCatalogClientVersion)
        ?? DEFAULT_PRODUCT_CONFIG.codex.modelCatalogClientVersion,
      endpoints: {
        deviceAuthorization: endpoint("deviceAuthorization", "authorization"),
        devicePoll: endpoint("devicePoll", "authorization"),
        token: endpoint("token", "token_exchange"),
        verification: endpoint("verification", "authorization"),
        redirectUri: endpoint("redirectUri", "authorization"),
        revoke: endpoint("revoke", "revocation"),
        resource: endpoint("resource", "resource"),
        models: endpoint("models", "models"),
        jwks: endpoint("jwks", "identity"),
      },
    };
  }

  if (input.product === "xai") {
    const issuer = resolveProviderEndpoint({
      product: input.product,
      purpose: "authorization",
      value: nonEmpty(input.issuer)!,
    }).replace(/\/$/, "");
    return {
      product: input.product,
      clientId,
      scopes: resolvedScopes,
      userAgent,
      issuer,
      endpoints: {
        discovery: resolveProviderEndpoint({
          product: input.product,
          purpose: "discovery",
          value: override.discovery ?? DEFAULT_ENDPOINTS.xai.discovery,
        }),
        resource: resolveProviderEndpoint({
          product: input.product,
          purpose: "resource",
          value: override.resource ?? DEFAULT_ENDPOINTS.xai.resource,
        }),
        models: resolveProviderEndpoint({
          product: input.product,
          purpose: "models",
          value: override.models ?? DEFAULT_ENDPOINTS.xai.models,
        }),
      },
    };
  }

  const profile = input.integrationProfile!;
  assertHeaderValue("copilot-integration-id", nonEmpty(profile.integrationId)!);
  assertHeaderValue("editor-version", nonEmpty(profile.editorVersion)!);
  assertHeaderValue("editor-plugin-version", nonEmpty(profile.editorPluginVersion)!);
  assertHeaderValue("x-github-api-version", nonEmpty(profile.apiVersion)!);
  const endpoint = (
    key: keyof typeof DEFAULT_ENDPOINTS.github_copilot,
    purpose: Parameters<typeof resolveProviderEndpoint>[0]["purpose"],
  ) => resolveProviderEndpoint({
    product: input.product,
    purpose,
    value: override[key] ?? DEFAULT_ENDPOINTS.github_copilot[key],
  });
  return {
    product: input.product,
    clientId,
    clientSecret: nonEmpty(input.clientSecret) ?? "",
    scopes: resolvedScopes,
    userAgent,
    integrationProfile: {
      integrationId: nonEmpty(profile.integrationId)!,
      editorVersion: nonEmpty(profile.editorVersion)!,
      editorPluginVersion: nonEmpty(profile.editorPluginVersion)!,
      apiVersion: nonEmpty(profile.apiVersion)!,
    },
    endpoints: {
      deviceAuthorization: endpoint("deviceAuthorization", "authorization"),
      token: endpoint("token", "token_exchange"),
      identity: endpoint("identity", "identity"),
      copilotToken: endpoint("copilotToken", "token_exchange"),
      revoke: endpoint("revoke", "revocation"),
      resource: endpoint("resource", "resource"),
      models: endpoint("models", "models"),
    },
  };
}

function splitScopes(value: string | undefined): string[] | undefined {
  const result = value?.split(/[\s,]+/).map((item) => item.trim()).filter(Boolean);
  return result && result.length > 0 ? result : undefined;
}

function endpointOverrides(environment: NodeJS.ProcessEnv, prefix: string): ProviderEndpointOverrides {
  return {
    deviceAuthorization: nonEmpty(environment[`${prefix}_DEVICE_AUTHORIZATION_ENDPOINT`]),
    devicePoll: nonEmpty(environment[`${prefix}_DEVICE_POLL_ENDPOINT`]),
    token: nonEmpty(environment[`${prefix}_TOKEN_ENDPOINT`]),
    verification: nonEmpty(environment[`${prefix}_VERIFICATION_ENDPOINT`]),
    redirectUri: nonEmpty(environment[`${prefix}_REDIRECT_URI`]),
    discovery: nonEmpty(environment[`${prefix}_DISCOVERY_ENDPOINT`]),
    jwks: nonEmpty(environment[`${prefix}_JWKS_ENDPOINT`]),
    identity: nonEmpty(environment[`${prefix}_IDENTITY_ENDPOINT`]),
    copilotToken: nonEmpty(environment[`${prefix}_COPILOT_TOKEN_ENDPOINT`]),
    revoke: nonEmpty(environment[`${prefix}_REVOKE_ENDPOINT`]),
    resource: nonEmpty(environment[`${prefix}_RESOURCE_ENDPOINT`]),
    models: nonEmpty(environment[`${prefix}_MODELS_ENDPOINT`]),
  };
}

export function providerProductConfigsFromEnv(
  environment: NodeJS.ProcessEnv = process.env,
): ProviderProductConfigs {
  return {
    codex: {
      product: "codex",
      clientId: nonEmpty(environment.INK_PROVIDER_CODEX_CLIENT_ID)
        ?? DEFAULT_PRODUCT_CONFIG.codex.clientId,
      scopes: splitScopes(environment.INK_PROVIDER_CODEX_SCOPES)
        ?? DEFAULT_PRODUCT_CONFIG.codex.scopes,
      userAgent: nonEmpty(environment.INK_PROVIDER_CODEX_USER_AGENT)
        ?? DEFAULT_PRODUCT_CONFIG.codex.userAgent,
      integrationId: nonEmpty(environment.INK_PROVIDER_CODEX_INTEGRATION_ID)
        ?? DEFAULT_PRODUCT_CONFIG.codex.integrationId,
      integrationVersion: nonEmpty(environment.INK_PROVIDER_CODEX_INTEGRATION_VERSION)
        ?? DEFAULT_PRODUCT_CONFIG.codex.integrationVersion,
      modelCatalogClientVersion:
        nonEmpty(environment.INK_PROVIDER_CODEX_MODEL_CATALOG_CLIENT_VERSION)
        ?? DEFAULT_PRODUCT_CONFIG.codex.modelCatalogClientVersion,
      endpoints: endpointOverrides(environment, "INK_PROVIDER_CODEX"),
    },
    xai: {
      product: "xai",
      clientId: nonEmpty(environment.INK_PROVIDER_XAI_CLIENT_ID)
        ?? DEFAULT_PRODUCT_CONFIG.xai.clientId,
      scopes: splitScopes(environment.INK_PROVIDER_XAI_SCOPES)
        ?? DEFAULT_PRODUCT_CONFIG.xai.scopes,
      userAgent: nonEmpty(environment.INK_PROVIDER_XAI_USER_AGENT)
        ?? DEFAULT_PRODUCT_CONFIG.xai.userAgent,
      issuer: nonEmpty(environment.INK_PROVIDER_XAI_ISSUER)
        ?? DEFAULT_PRODUCT_CONFIG.xai.issuer,
      endpoints: endpointOverrides(environment, "INK_PROVIDER_XAI"),
    },
    github_copilot: {
      product: "github_copilot",
      clientId: nonEmpty(environment.INK_PROVIDER_GITHUB_COPILOT_CLIENT_ID)
        ?? DEFAULT_PRODUCT_CONFIG.github_copilot.clientId,
      clientSecret: nonEmpty(environment.INK_PROVIDER_GITHUB_COPILOT_CLIENT_SECRET),
      scopes: splitScopes(environment.INK_PROVIDER_GITHUB_COPILOT_SCOPES)
        ?? DEFAULT_PRODUCT_CONFIG.github_copilot.scopes,
      userAgent: nonEmpty(environment.INK_PROVIDER_GITHUB_COPILOT_USER_AGENT)
        ?? DEFAULT_PRODUCT_CONFIG.github_copilot.userAgent,
      integrationProfile: {
        integrationId: nonEmpty(environment.INK_PROVIDER_GITHUB_COPILOT_INTEGRATION_ID)
          ?? DEFAULT_PRODUCT_CONFIG.github_copilot.integrationProfile.integrationId,
        editorVersion: nonEmpty(environment.INK_PROVIDER_GITHUB_COPILOT_EDITOR_VERSION)
          ?? DEFAULT_PRODUCT_CONFIG.github_copilot.integrationProfile.editorVersion,
        editorPluginVersion: nonEmpty(environment.INK_PROVIDER_GITHUB_COPILOT_EDITOR_PLUGIN_VERSION)
          ?? DEFAULT_PRODUCT_CONFIG.github_copilot.integrationProfile.editorPluginVersion,
        apiVersion: nonEmpty(environment.INK_PROVIDER_GITHUB_COPILOT_API_VERSION)
          ?? DEFAULT_PRODUCT_CONFIG.github_copilot.integrationProfile.apiVersion,
      },
      endpoints: endpointOverrides(environment, "INK_PROVIDER_GITHUB_COPILOT"),
    },
  };
}
