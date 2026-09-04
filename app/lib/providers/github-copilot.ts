// [Input] Deployment-owned GitHub OAuth App registration/profile, device grant, and caller-owned token bundle.
// [Output] GitHub identity, Copilot token lifecycle, safe model catalog, revoke, and Chat contract.
// [Pos] Copilot product adapter; ordinary GitHub OAuth success is never reported as a connected Copilot account.
// [Sync] 2026-09-04: add filtered Copilot discovery with per-vendor compatibility and a bounded catalog budget.

import type {
  GitHubCopilotDeploymentConfigInput,
  ResolvedGitHubCopilotConfig,
} from "./config";
import { providerReadiness, resolveProviderConfig } from "./config";
import {
  resolveProviderEndpoint,
  resolveProviderVerificationUri,
} from "./endpoint-policy";
import { operationFailure, ProviderProtocolError } from "./errors";
import {
  oauthErrorCode,
  MAX_MODEL_CATALOG_RESPONSE_BYTES,
  optionalString,
  positiveNumber,
  readJsonRecord,
  requiredString,
  throwForHttpStatus,
  type JsonRecord,
} from "./http";
import {
  assertProduct,
  expiresAtMs,
  formBody,
  grantedScopes,
  invalidGrantStatus,
  providerFetch,
  type AdapterDependencies,
} from "./shared";
import { createProviderRevocationHandoff } from "./types";
import type {
  DeviceFlowState,
  DevicePollResult,
  DeviceStartResult,
  GitHubCopilotIdentity,
  GitHubCopilotTokenBundle,
  ProviderCatalogModel,
  ProviderModelCatalogResult,
  ProviderProductAdapter,
  ProviderReadiness,
  ProviderRevocationMaterial,
  ProviderTokenBundle,
  ResourceContractResult,
  RevokeResult,
  TokenLifecycleResult,
} from "./types";

type SourceToken = Readonly<{
  accessToken: string;
  refreshToken?: string;
  expiresAtMs?: number;
  grantedScopes: readonly string[];
}>;

type ShortCopilotToken = Readonly<{
  token: string;
  expiresAtMs: number;
}>;

function parseCopilotModelCatalog(value: JsonRecord): readonly ProviderCatalogModel[] {
  if (!Array.isArray(value.data)) {
    throw new ProviderProtocolError({
      code: "COPILOT_MODEL_CATALOG_INVALID",
      category: "protocol",
      message: "The Copilot model catalog response is invalid",
    });
  }
  return value.data.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ProviderProtocolError({
        code: "COPILOT_MODEL_CATALOG_INVALID",
        category: "protocol",
        message: "The Copilot model catalog response is invalid",
      });
    }
    const record = entry as JsonRecord;
    if (typeof record.model_picker_enabled !== "boolean") {
      throw new ProviderProtocolError({
        code: "COPILOT_MODEL_CATALOG_INVALID",
        category: "protocol",
        message: "The Copilot model catalog response is invalid",
      });
    }
    return {
      id: requiredString(record.id, "COPILOT_MODEL_CATALOG_INVALID").trim(),
      displayName: requiredString(record.name, "COPILOT_MODEL_CATALOG_INVALID").trim(),
      vendor: requiredString(record.vendor, "COPILOT_MODEL_CATALOG_INVALID").trim(),
      enabled: record.model_picker_enabled,
    };
  }).filter((model) => model.enabled).map((model): ProviderCatalogModel => {
    const usesResponses = model.vendor.toLowerCase() === "openai";
    return {
      id: model.id,
      displayName: model.displayName,
      vendor: model.vendor,
      upstreamDialect: usesResponses ? "openai_responses" : "openai_chat",
      gatewayCompatible: !usesResponses,
      capabilities: [],
    };
  });
}

export class GitHubCopilotProviderAdapter implements ProviderProductAdapter {
  readonly product = "github_copilot" as const;

  constructor(
    private readonly input: GitHubCopilotDeploymentConfigInput | undefined,
    private readonly dependencies: AdapterDependencies,
  ) {}

  readiness(): ProviderReadiness {
    return providerReadiness(this.product, this.input);
  }

  private config(): ResolvedGitHubCopilotConfig {
    const resolved = resolveProviderConfig(this.input ?? { product: this.product });
    if (resolved.product !== this.product) throw new Error("unreachable");
    return resolved;
  }

  private profileHeaders(config: ResolvedGitHubCopilotConfig): Record<string, string> {
    return {
      "user-agent": config.userAgent,
      "editor-version": config.integrationProfile.editorVersion,
      "editor-plugin-version": config.integrationProfile.editorPluginVersion,
      "copilot-integration-id": config.integrationProfile.integrationId,
      "x-github-api-version": config.integrationProfile.apiVersion,
    };
  }

  async startDevice(): Promise<DeviceStartResult> {
    try {
      const config = this.config();
      const response = await providerFetch(this.dependencies, config.endpoints.deviceAuthorization, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": config.userAgent,
        },
        body: formBody({ client_id: config.clientId, scope: config.scopes.join(" ") }),
      });
      const value = await readJsonRecord(response);
      if (!response.ok) throwForHttpStatus(response, "GITHUB_DEVICE_START_FAILED");
      const verificationUri = resolveProviderEndpoint({
        product: this.product,
        purpose: "authorization",
        value: requiredString(value.verification_uri, "GITHUB_DEVICE_RESPONSE_INVALID"),
      });
      const verificationUriCompleteValue = optionalString(value.verification_uri_complete);
      const verificationUriComplete = verificationUriCompleteValue
        ? resolveProviderVerificationUri({
            product: this.product,
            value: verificationUriCompleteValue,
          })
        : undefined;
      const flow: DeviceFlowState = {
        product: this.product,
        deviceCode: requiredString(value.device_code, "GITHUB_DEVICE_RESPONSE_INVALID"),
        userCode: requiredString(value.user_code, "GITHUB_DEVICE_RESPONSE_INVALID"),
        verificationUri,
        ...(verificationUriComplete ? { verificationUriComplete } : {}),
        expiresInSeconds: positiveNumber(value.expires_in),
        intervalSeconds: positiveNumber(value.interval, 5),
      };
      return { status: "verification_required", product: this.product, flow };
    } catch (error) {
      return operationFailure(this.product, error);
    }
  }

  async pollDevice(flow: DeviceFlowState): Promise<DevicePollResult> {
    let revocationMaterial: ProviderRevocationMaterial | undefined;
    try {
      assertProduct(this.product, flow.product);
      const config = this.config();
      const response = await providerFetch(this.dependencies, config.endpoints.token, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": config.userAgent,
        },
        body: formBody({
          client_id: config.clientId,
          device_code: flow.deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      });
      const value = await readJsonRecord(response);
      const error = oauthErrorCode(value);
      if (error === "authorization_pending") {
        return { status: "pending", product: this.product, retryAfterSeconds: flow.intervalSeconds };
      }
      if (error === "slow_down") {
        return { status: "slow_down", product: this.product, retryAfterSeconds: flow.intervalSeconds + 5 };
      }
      if (error === "access_denied") return { status: "denied", product: this.product };
      if (error === "expired_token") return { status: "expired", product: this.product };
      if (error === "device_flow_disabled") {
        throw new ProviderProtocolError({
          code: "GITHUB_DEVICE_FLOW_DISABLED",
          category: "configuration",
          message: "Device Flow is not enabled for the configured GitHub OAuth App",
        });
      }
      if (error === "incorrect_client_credentials") {
        throw new ProviderProtocolError({
          code: "GITHUB_CLIENT_REGISTRATION_REJECTED",
          category: "configuration",
          message: "GitHub rejected the configured OAuth App registration",
          httpStatus: response.status,
        });
      }
      if (error === "incorrect_device_code") {
        throw new ProviderProtocolError({
          code: "GITHUB_DEVICE_CODE_INVALID",
          category: "protocol",
          message: "GitHub rejected the device authorization state",
          httpStatus: response.status,
        });
      }
      if (error === "unsupported_grant_type") {
        throw new ProviderProtocolError({
          code: "GITHUB_DEVICE_GRANT_UNSUPPORTED",
          category: "protocol",
          message: "GitHub rejected the Device Authorization grant type",
          httpStatus: response.status,
        });
      }
      if (error) {
        throw new ProviderProtocolError({
          code: "GITHUB_DEVICE_POLL_FAILED",
          category: "protocol",
          message: "GitHub rejected the device authorization request",
          retryable: response.status === 429 || response.status >= 500,
          httpStatus: response.status,
        });
      }
      if (!response.ok) throwForHttpStatus(response, "GITHUB_DEVICE_POLL_FAILED");

      const source = this.sourceToken(value, config.scopes, config.scopes, (material) => {
        revocationMaterial = material;
      });
      const identity = await this.fetchIdentity(config, source.accessToken);
      const copilot = await this.exchangeCopilotToken(config, source.accessToken);
      const bundle: GitHubCopilotTokenBundle = {
        product: this.product,
        sourceAccessToken: source.accessToken,
        ...(source.refreshToken ? { sourceRefreshToken: source.refreshToken } : {}),
        ...(source.expiresAtMs ? { sourceExpiresAtMs: source.expiresAtMs } : {}),
        copilotAccessToken: copilot.token,
        copilotExpiresAtMs: copilot.expiresAtMs,
        grantedScopes: source.grantedScopes,
        identity,
      };
      return { status: "connected", product: this.product, bundle };
    } catch (error) {
      return operationFailure(this.product, error, revocationMaterial);
    }
  }

  private sourceToken(
    value: JsonRecord,
    fallbackScopes: readonly string[],
    requiredScopes: readonly string[],
    onIssued?: (material: ProviderRevocationMaterial) => void,
  ): SourceToken {
    const accessToken = requiredString(value.access_token, "GITHUB_ACCESS_TOKEN_MISSING");
    onIssued?.({ product: this.product, sourceAccessToken: accessToken });
    const refreshToken = optionalString(value.refresh_token);
    const expiresIn = typeof value.expires_in === "number" ? value.expires_in : undefined;
    return {
      accessToken,
      ...(refreshToken ? { refreshToken } : {}),
      ...(expiresIn ? { expiresAtMs: expiresAtMs(this.dependencies.now(), expiresIn) } : {}),
      grantedScopes: grantedScopes(value.scope, fallbackScopes, requiredScopes),
    };
  }

  private async fetchIdentity(
    config: ResolvedGitHubCopilotConfig,
    sourceAccessToken: string,
  ): Promise<GitHubCopilotIdentity> {
    const response = await providerFetch(this.dependencies, config.endpoints.identity, {
      method: "GET",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${sourceAccessToken}`,
        ...this.profileHeaders(config),
      },
    });
    const value = await readJsonRecord(response);
    if (!response.ok) throwForHttpStatus(response, "GITHUB_IDENTITY_FAILED");
    const numericId = value.id;
    if (
      typeof numericId !== "number" ||
      !Number.isSafeInteger(numericId) ||
      numericId <= 0
    ) {
      throw new ProviderProtocolError({
        code: "GITHUB_NUMERIC_ID_MISSING",
        category: "protocol",
        message: "GitHub did not return a stable numeric user identity",
      });
    }
    return {
      numericId,
      login: requiredString(value.login, "GITHUB_LOGIN_MISSING"),
    };
  }

  private async exchangeCopilotToken(
    config: ResolvedGitHubCopilotConfig,
    sourceAccessToken: string,
  ): Promise<ShortCopilotToken> {
    const response = await providerFetch(this.dependencies, config.endpoints.copilotToken, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${sourceAccessToken}`,
        ...this.profileHeaders(config),
      },
    });
    if (response.status === 403) {
      throw new ProviderProtocolError({
        code: "COPILOT_ENTITLEMENT_REQUIRED",
        category: "entitlement",
        message: "The GitHub account does not have an available Copilot entitlement",
        httpStatus: 403,
      });
    }
    const value = await readJsonRecord(response);
    if (!response.ok) throwForHttpStatus(response, "COPILOT_TOKEN_EXCHANGE_FAILED");
    const expiresAt = positiveNumber(value.expires_at);
    return {
      token: requiredString(value.token, "COPILOT_ACCESS_TOKEN_MISSING"),
      expiresAtMs: expiresAt > 10_000_000_000 ? expiresAt : expiresAt * 1000,
    };
  }

  private async refreshSourceToken(
    config: ResolvedGitHubCopilotConfig,
    current: GitHubCopilotTokenBundle,
    onIssued: (material: ProviderRevocationMaterial) => void,
  ): Promise<SourceToken | "reauthorize"> {
    if (!current.sourceRefreshToken) return "reauthorize";
    const response = await providerFetch(this.dependencies, config.endpoints.token, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": config.userAgent,
      },
      body: formBody({
        grant_type: "refresh_token",
        refresh_token: current.sourceRefreshToken,
        client_id: config.clientId,
      }),
    });
    if (response.status === 401 || response.status === 403) return "reauthorize";
    const value = await readJsonRecord(response);
    const error = oauthErrorCode(value);
    if (invalidGrantStatus(response.status, error) || error === "bad_refresh_token") {
      return "reauthorize";
    }
    if (!response.ok || error) throwForHttpStatus(response, "GITHUB_SOURCE_REFRESH_FAILED");
    const source = this.sourceToken(value, current.grantedScopes, config.scopes, onIssued);
    return {
      ...source,
      refreshToken: source.refreshToken ?? current.sourceRefreshToken,
    };
  }

  async refreshOrRenew(bundle: ProviderTokenBundle): Promise<TokenLifecycleResult> {
    let revocationMaterial: ProviderRevocationMaterial | undefined;
    try {
      assertProduct(this.product, bundle.product);
      const current = bundle as GitHubCopilotTokenBundle;
      const config = this.config();
      let source: SourceToken = {
        accessToken: current.sourceAccessToken,
        ...(current.sourceRefreshToken ? { refreshToken: current.sourceRefreshToken } : {}),
        ...(current.sourceExpiresAtMs ? { expiresAtMs: current.sourceExpiresAtMs } : {}),
        grantedScopes: current.grantedScopes,
      };
      if (source.expiresAtMs !== undefined && source.expiresAtMs <= this.dependencies.now() + 60_000) {
        const refreshed = await this.refreshSourceToken(config, current, (material) => {
          if (material.product === this.product
            && material.sourceAccessToken !== current.sourceAccessToken) {
            revocationMaterial = material;
          }
        });
        if (refreshed === "reauthorize") {
          return {
            status: "reauthorization_required",
            product: this.product,
            reason: "source_token_expired",
          };
        }
        source = refreshed;
      }
      const identity = await this.fetchIdentity(config, source.accessToken);
      if (identity.numericId !== current.identity.numericId) {
        return {
          status: "reauthorization_required",
          product: this.product,
          reason: "identity_changed",
          ...(revocationMaterial
            ? { revocationHandoff: createProviderRevocationHandoff(revocationMaterial) }
            : {}),
        };
      }
      const copilot = await this.exchangeCopilotToken(config, source.accessToken);
      const next: GitHubCopilotTokenBundle = {
        product: this.product,
        sourceAccessToken: source.accessToken,
        ...(source.refreshToken ? { sourceRefreshToken: source.refreshToken } : {}),
        ...(source.expiresAtMs ? { sourceExpiresAtMs: source.expiresAtMs } : {}),
        copilotAccessToken: copilot.token,
        copilotExpiresAtMs: copilot.expiresAtMs,
        grantedScopes: source.grantedScopes,
        identity,
      };
      return {
        status: "ready",
        product: this.product,
        bundle: next,
        rotated:
          next.sourceAccessToken !== current.sourceAccessToken ||
          next.sourceRefreshToken !== current.sourceRefreshToken ||
          next.copilotAccessToken !== current.copilotAccessToken,
        ...(revocationMaterial
          ? { revocationHandoff: createProviderRevocationHandoff(revocationMaterial) }
          : {}),
      };
    } catch (error) {
      if (
        error instanceof ProviderProtocolError &&
        error.httpStatus === 401 &&
        ["GITHUB_IDENTITY_FAILED", "COPILOT_TOKEN_EXCHANGE_FAILED"].includes(error.code)
      ) {
        return {
          status: "reauthorization_required",
          product: this.product,
          reason: "source_token_expired",
          ...(revocationMaterial
            ? { revocationHandoff: createProviderRevocationHandoff(revocationMaterial) }
            : {}),
        };
      }
      return operationFailure(this.product, error, revocationMaterial);
    }
  }

  async revoke(material: ProviderRevocationMaterial): Promise<RevokeResult> {
    try {
      assertProduct(this.product, material.product);
      if (material.product !== this.product) throw new Error("unreachable");
      const config = this.config();
      if (!config.clientSecret) {
        return {
          status: "unsupported",
          product: this.product,
          reason: "remote_revoke_not_configured",
        };
      }
      const base = config.endpoints.revoke.endsWith("/")
        ? config.endpoints.revoke
        : `${config.endpoints.revoke}/`;
      const revokeUrl = new URL(`${encodeURIComponent(config.clientId)}/token`, base).toString();
      const response = await providerFetch(this.dependencies, revokeUrl, {
        method: "DELETE",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
          "content-type": "application/json",
          "user-agent": config.userAgent,
          "x-github-api-version": config.integrationProfile.apiVersion,
        },
        body: JSON.stringify({ access_token: material.sourceAccessToken }),
      });
      if (!response.ok) throwForHttpStatus(response, "GITHUB_REVOKE_FAILED");
      return { status: "revoked", product: this.product, remote: true };
    } catch (error) {
      return operationFailure(this.product, error);
    }
  }

  async fetchModelCatalog(bundle: ProviderTokenBundle): Promise<ProviderModelCatalogResult> {
    try {
      assertProduct(this.product, bundle.product);
      const current = bundle as GitHubCopilotTokenBundle;
      const config = this.config();
      const response = await providerFetch(this.dependencies, config.endpoints.models, {
        method: "GET",
        headers: {
          authorization: `Bearer ${current.copilotAccessToken}`,
          "content-type": "application/json",
          ...this.profileHeaders(config),
        },
      });
      if (!response.ok) throwForHttpStatus(response, "COPILOT_MODEL_CATALOG_FAILED");
      const value = await readJsonRecord(response, {
        maxBytes: MAX_MODEL_CATALOG_RESPONSE_BYTES,
      });
      return {
        status: "ready",
        product: this.product,
        endpoint: config.endpoints.models,
        models: parseCopilotModelCatalog(value),
      };
    } catch (error) {
      return operationFailure(this.product, error);
    }
  }

  getResourceContract(): ResourceContractResult {
    try {
      const config = this.config();
      return {
        status: "ready",
        product: this.product,
        contract: {
          product: this.product,
          dialect: "openai_chat",
          url: config.endpoints.resource,
          managedHeaderNames: [
            "authorization",
            "user-agent",
            "editor-version",
            "editor-plugin-version",
            "copilot-integration-id",
            "x-github-api-version",
            "content-type",
          ],
          buildHeaders: (bundle) => {
            try {
              assertProduct(this.product, bundle.product);
              const current = bundle as GitHubCopilotTokenBundle;
              return {
                status: "ready",
                headers: new Headers({
                  authorization: `Bearer ${current.copilotAccessToken}`,
                  ...this.profileHeaders(config),
                  "content-type": "application/json",
                }),
              };
            } catch (error) {
              return operationFailure(this.product, error);
            }
          },
        },
      };
    } catch (error) {
      return operationFailure(this.product, error);
    }
  }
}
