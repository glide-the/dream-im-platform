// [Input] Deployment-owned Codex registration, custom device state, and encrypted token bundle supplied by a caller.
// [Output] Codex auth lifecycle, account model catalog, identity, and Responses contracts.
// [Pos] First-party-sensitive adapter; no Codex client ID or integration fingerprint is embedded here.
// [Sync] 2026-09-04: add the account-scoped ChatGPT Codex catalog with an isolated bounded byte budget.

import type { CodexDeploymentConfigInput, ResolvedCodexConfig } from "./config";
import { providerReadiness, resolveProviderConfig } from "./config";
import { operationFailure, ProviderProtocolError } from "./errors";
import {
  oauthErrorCode,
  MAX_MODEL_CATALOG_RESPONSE_BYTES,
  optionalString,
  positiveNumber,
  readJsonRecord,
  readJsonValue,
  requiredString,
  throwForHttpStatus,
  type JsonContainer,
  type JsonRecord,
} from "./http";
import { codexAccountId, requiredSubject, verifyOidcIdentityToken } from "./jwt";
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
  CodexIdentity,
  CodexTokenBundle,
  DeviceFlowState,
  DevicePollResult,
  DeviceStartResult,
  ProviderProductAdapter,
  ProviderCatalogModel,
  ProviderModelCatalogResult,
  ProviderReadiness,
  ProviderRevocationMaterial,
  ProviderTokenBundle,
  ResourceContractResult,
  RevokeResult,
  TokenLifecycleResult,
} from "./types";

function jsonRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function firstTrimmedString(
  record: JsonRecord,
  keys: readonly string[],
): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return undefined;
}

function codexCatalogModel(
  entry: unknown,
  fallbackId?: string,
): ProviderCatalogModel | undefined {
  if (typeof entry === "string" && entry.trim() !== "") {
    const id = entry.trim();
    return {
      id,
      displayName: id,
      vendor: "Codex",
      upstreamDialect: "openai_responses",
      gatewayCompatible: true,
      capabilities: [],
    };
  }
  const record = jsonRecord(entry);
  const id = record
    ? firstTrimmedString(record, ["slug", "id", "model", "name"])
      ?? fallbackId?.trim()
    : fallbackId?.trim();
  if (!id) return undefined;
  return {
    id,
    displayName: record
      ? firstTrimmedString(record, ["display_name", "displayName", "name"]) ?? id
      : id,
    vendor: record
      ? firstTrimmedString(
          record,
          ["owned_by", "ownedBy", "provider", "vendor", "category", "owner"],
        ) ?? "Codex"
      : "Codex",
    upstreamDialect: "openai_responses",
    gatewayCompatible: true,
    capabilities: [],
  };
}

function parseCodexModelCatalog(value: JsonContainer): readonly ProviderCatalogModel[] {
  const record = jsonRecord(value);
  const entries = Array.isArray(value)
    ? value
    : [record?.data, record?.models, record?.items].find(Array.isArray);
  const models: ProviderCatalogModel[] = [];
  if (entries) {
    for (const entry of entries) {
      const model = codexCatalogModel(entry);
      if (model) models.push(model);
    }
  }
  const modelMap = jsonRecord(record?.models);
  if (modelMap) {
    for (const [id, entry] of Object.entries(modelMap)) {
      const model = codexCatalogModel(entry, id);
      if (model) models.push(model);
    }
  }
  models.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return models.filter((model, index) => index === 0 || models[index - 1]?.id !== model.id);
}

export class CodexProviderAdapter implements ProviderProductAdapter {
  readonly product = "codex" as const;

  constructor(
    private readonly input: CodexDeploymentConfigInput | undefined,
    private readonly dependencies: AdapterDependencies,
  ) {}

  readiness(): ProviderReadiness {
    return providerReadiness(this.product, this.input);
  }

  private config(): ResolvedCodexConfig {
    const resolved = resolveProviderConfig(this.input ?? { product: this.product });
    if (resolved.product !== this.product) throw new Error("unreachable");
    return resolved;
  }

  async startDevice(): Promise<DeviceStartResult> {
    try {
      const config = this.config();
      const response = await providerFetch(this.dependencies, config.endpoints.deviceAuthorization, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": config.userAgent },
        body: JSON.stringify({ client_id: config.clientId }),
      });
      const value = await readJsonRecord(response);
      if (!response.ok) throwForHttpStatus(response, "CODEX_DEVICE_START_FAILED");
      const flow: DeviceFlowState = {
        product: this.product,
        deviceCode: requiredString(value.device_auth_id, "CODEX_DEVICE_RESPONSE_INVALID"),
        userCode: requiredString(value.user_code, "CODEX_DEVICE_RESPONSE_INVALID"),
        verificationUri: config.endpoints.verification,
        expiresInSeconds: positiveNumber(value.expires_in, 900),
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
      const response = await providerFetch(this.dependencies, config.endpoints.devicePoll, {
        method: "POST",
        headers: { "content-type": "application/json", "user-agent": config.userAgent },
        body: JSON.stringify({
          device_auth_id: flow.deviceCode,
          user_code: flow.userCode,
        }),
      });
      if (response.status === 403 || response.status === 404) {
        return {
          status: "pending",
          product: this.product,
          retryAfterSeconds: flow.intervalSeconds,
        };
      }
      if (response.status === 410) return { status: "expired", product: this.product };
      const value = await readJsonRecord(response);
      if (!response.ok) throwForHttpStatus(response, "CODEX_DEVICE_POLL_FAILED");
      const tokenValue = await this.exchangeAuthorizationCode(
        config,
        requiredString(value.authorization_code, "CODEX_DEVICE_RESPONSE_INVALID"),
        requiredString(value.code_verifier, "CODEX_DEVICE_RESPONSE_INVALID"),
      );
      revocationMaterial = {
        product: this.product,
        refreshToken: requiredString(tokenValue.refresh_token, "CODEX_REFRESH_TOKEN_MISSING"),
      };
      const bundle = await this.tokenBundleFromResponse(tokenValue, config);
      return { status: "connected", product: this.product, bundle };
    } catch (error) {
      return operationFailure(this.product, error, revocationMaterial);
    }
  }

  private async exchangeAuthorizationCode(
    config: ResolvedCodexConfig,
    code: string,
    codeVerifier: string,
  ): Promise<JsonRecord> {
    const response = await providerFetch(this.dependencies, config.endpoints.token, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": config.userAgent,
      },
      body: formBody({
        grant_type: "authorization_code",
        code,
        redirect_uri: config.endpoints.redirectUri,
        client_id: config.clientId,
        code_verifier: codeVerifier,
      }),
    });
    const value = await readJsonRecord(response);
    if (!response.ok) throwForHttpStatus(response, "CODEX_TOKEN_EXCHANGE_FAILED");
    return value;
  }

  private async identityFromResponse(
    value: JsonRecord,
    config: ResolvedCodexConfig,
  ): Promise<CodexIdentity> {
    const identityToken = requiredString(value.id_token, "CODEX_ID_TOKEN_MISSING");
    const response = await providerFetch(this.dependencies, config.endpoints.jwks, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": config.userAgent },
    });
    const jwks = await readJsonRecord(response);
    if (!response.ok) throwForHttpStatus(response, "CODEX_JWKS_FAILED");
    const claims = await verifyOidcIdentityToken(identityToken, jwks, {
      issuer: "https://auth.openai.com",
      audience: config.clientId,
      algorithms: ["RS256"],
    });
    return {
      subject: requiredSubject(claims),
      chatgptAccountId: codexAccountId(claims),
    };
  }

  private async tokenBundleFromResponse(
    value: JsonRecord,
    config: ResolvedCodexConfig,
  ): Promise<CodexTokenBundle> {
    const accessToken = requiredString(value.access_token, "CODEX_ACCESS_TOKEN_MISSING");
    const refreshToken = requiredString(value.refresh_token, "CODEX_REFRESH_TOKEN_MISSING");
    const idToken = optionalString(value.id_token);
    return {
      product: this.product,
      accessToken,
      refreshToken,
      ...(idToken ? { idToken } : {}),
      expiresAtMs: expiresAtMs(this.dependencies.now(), value.expires_in),
      grantedScopes: grantedScopes(value.scope, config.scopes),
      identity: await this.identityFromResponse(value, config),
    };
  }

  async refreshOrRenew(bundle: ProviderTokenBundle): Promise<TokenLifecycleResult> {
    let revocationMaterial: ProviderRevocationMaterial | undefined;
    try {
      assertProduct(this.product, bundle.product);
      const current = bundle as CodexTokenBundle;
      const config = this.config();
      const response = await providerFetch(this.dependencies, config.endpoints.token, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": config.userAgent,
        },
        body: formBody({
          grant_type: "refresh_token",
          refresh_token: current.refreshToken,
          client_id: config.clientId,
          scope: config.scopes.join(" "),
        }),
      });
      if (response.status === 401 || response.status === 403) {
        return {
          status: "reauthorization_required",
          product: this.product,
          reason: "invalid_grant",
        };
      }
      const value = await readJsonRecord(response);
      const errorCode = oauthErrorCode(value);
      if (invalidGrantStatus(response.status, errorCode)) {
        return {
          status: "reauthorization_required",
          product: this.product,
          reason: "invalid_grant",
        };
      }
      if (!response.ok || errorCode) throwForHttpStatus(response, "CODEX_REFRESH_FAILED");
      const accessToken = requiredString(value.access_token, "CODEX_ACCESS_TOKEN_MISSING");
      const issuedRefreshToken = optionalString(value.refresh_token);
      const refreshToken = issuedRefreshToken ?? current.refreshToken;
      if (issuedRefreshToken && issuedRefreshToken !== current.refreshToken) {
        revocationMaterial = { product: this.product, refreshToken: issuedRefreshToken };
      }
      const nextScopes = grantedScopes(value.scope, current.grantedScopes, config.scopes);
      const idToken = optionalString(value.id_token) ?? current.idToken;
      let identity = current.identity;
      if (optionalString(value.id_token)) {
        identity = await this.identityFromResponse(value, config);
        if (
          identity.subject !== current.identity.subject ||
          identity.chatgptAccountId !== current.identity.chatgptAccountId
        ) {
          return {
            status: "reauthorization_required",
            product: this.product,
            reason: "identity_changed",
            ...(revocationMaterial
              ? { revocationHandoff: createProviderRevocationHandoff(revocationMaterial) }
              : {}),
          };
        }
      }
      const next: CodexTokenBundle = {
        product: this.product,
        accessToken,
        refreshToken,
        ...(idToken ? { idToken } : {}),
        expiresAtMs: expiresAtMs(this.dependencies.now(), value.expires_in),
        grantedScopes: nextScopes,
        identity,
      };
      return {
        status: "ready",
        product: this.product,
        bundle: next,
        rotated: refreshToken !== current.refreshToken,
        ...(revocationMaterial
          ? { revocationHandoff: createProviderRevocationHandoff(revocationMaterial) }
          : {}),
      };
    } catch (error) {
      return operationFailure(this.product, error, revocationMaterial);
    }
  }

  async revoke(material: ProviderRevocationMaterial): Promise<RevokeResult> {
    try {
      assertProduct(this.product, material.product);
      if (material.product !== this.product) throw new Error("unreachable");
      const config = this.config();
      const response = await providerFetch(this.dependencies, config.endpoints.revoke, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": config.userAgent,
        },
        body: formBody({
          token: material.refreshToken,
          token_type_hint: "refresh_token",
          client_id: config.clientId,
        }),
      });
      if (!response.ok) throwForHttpStatus(response, "CODEX_REVOKE_FAILED");
      return { status: "revoked", product: this.product, remote: true };
    } catch (error) {
      return operationFailure(this.product, error);
    }
  }

  async fetchModelCatalog(bundle: ProviderTokenBundle): Promise<ProviderModelCatalogResult> {
    try {
      assertProduct(this.product, bundle.product);
      const current = bundle as CodexTokenBundle;
      const config = this.config();
      const url = new URL(config.endpoints.models);
      url.searchParams.set("client_version", config.modelCatalogClientVersion);
      const response = await providerFetch(this.dependencies, url, {
        method: "GET",
        headers: {
          authorization: `Bearer ${current.accessToken}`,
          originator: "cc-switch",
          "chatgpt-account-id": current.identity.chatgptAccountId,
        },
      });
      if (!response.ok) throwForHttpStatus(response, "CODEX_MODEL_CATALOG_FAILED");
      const value = await readJsonValue(response, {
        maxBytes: MAX_MODEL_CATALOG_RESPONSE_BYTES,
      });
      return {
        status: "ready",
        product: this.product,
        endpoint: config.endpoints.models,
        models: parseCodexModelCatalog(value),
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
          dialect: "openai_responses",
          url: config.endpoints.resource,
          managedHeaderNames: [
            "authorization",
            "chatgpt-account-id",
            "originator",
            "version",
            "user-agent",
            "content-type",
          ],
          buildHeaders: (bundle) => {
            try {
              assertProduct(this.product, bundle.product);
              const current = bundle as CodexTokenBundle;
              return {
                status: "ready",
                headers: new Headers({
                  authorization: `Bearer ${current.accessToken}`,
                  "chatgpt-account-id": current.identity.chatgptAccountId,
                  originator: config.integrationId,
                  version: config.integrationVersion,
                  "user-agent": config.userAgent,
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
