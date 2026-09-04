// [Input] Deployment-owned xAI OIDC registration, RFC 8628 device state, and caller-supplied token bundle.
// [Output] Discovery-validated auth lifecycle, strict account model catalog, and Responses contract.
// [Pos] xAI managed product adapter; discovery never expands the fixed auth.x.ai trust boundary.
// [Sync] 2026-09-04: add strict xAI /v1/models fetching with an isolated bounded catalog budget.

import type { ResolvedXaiConfig, XaiDeploymentConfigInput } from "./config";
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
import { requiredSubject, verifyOidcIdentityToken } from "./jwt";
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
  ProviderProductAdapter,
  ProviderCatalogModel,
  ProviderModelCatalogResult,
  ProviderReadiness,
  ProviderRevocationMaterial,
  ProviderTokenBundle,
  ResourceContractResult,
  RevokeResult,
  TokenLifecycleResult,
  XaiIdentity,
  XaiTokenBundle,
} from "./types";

type XaiEndpoints = Readonly<{
  deviceAuthorization: string;
  token: string;
  revoke: string;
  jwks: string;
}>;

function parseXaiModelCatalog(value: JsonRecord): readonly ProviderCatalogModel[] {
  if (!Array.isArray(value.data)) {
    throw new ProviderProtocolError({
      code: "XAI_MODEL_CATALOG_INVALID",
      category: "protocol",
      message: "The xAI model catalog response is invalid",
    });
  }
  const models = value.data.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new ProviderProtocolError({
        code: "XAI_MODEL_CATALOG_INVALID",
        category: "protocol",
        message: "The xAI model catalog response is invalid",
      });
    }
    const record = entry as JsonRecord;
    const id = requiredString(record.id, "XAI_MODEL_CATALOG_INVALID").trim();
    if (
      record.owned_by !== undefined &&
      record.owned_by !== null &&
      typeof record.owned_by !== "string"
    ) {
      throw new ProviderProtocolError({
        code: "XAI_MODEL_CATALOG_INVALID",
        category: "protocol",
        message: "The xAI model catalog response is invalid",
      });
    }
    const vendor = typeof record.owned_by === "string" && record.owned_by.trim() !== ""
      ? record.owned_by.trim()
      : "xAI";
    return {
      id,
      displayName: id,
      vendor,
      upstreamDialect: "openai_responses" as const,
      gatewayCompatible: true,
      capabilities: [],
    };
  });
  models.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return models;
}

export class XaiProviderAdapter implements ProviderProductAdapter {
  readonly product = "xai" as const;
  private discoveredEndpoints?: XaiEndpoints;

  constructor(
    private readonly input: XaiDeploymentConfigInput | undefined,
    private readonly dependencies: AdapterDependencies,
  ) {}

  readiness(): ProviderReadiness {
    return providerReadiness(this.product, this.input);
  }

  private config(): ResolvedXaiConfig {
    const resolved = resolveProviderConfig(this.input ?? { product: this.product });
    if (resolved.product !== this.product) throw new Error("unreachable");
    return resolved;
  }

  private async endpoints(config: ResolvedXaiConfig): Promise<XaiEndpoints> {
    if (this.discoveredEndpoints) return this.discoveredEndpoints;
    const response = await providerFetch(this.dependencies, config.endpoints.discovery, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": config.userAgent },
    });
    const value = await readJsonRecord(response);
    if (!response.ok) throwForHttpStatus(response, "XAI_DISCOVERY_FAILED");
    const issuer = requiredString(value.issuer, "XAI_DISCOVERY_INVALID");
    if (issuer !== config.issuer) {
      throw new ProviderProtocolError({
        code: "XAI_DISCOVERY_ISSUER_MISMATCH",
        category: "protocol",
        message: "The xAI discovery issuer does not match deployment configuration",
      });
    }
    const endpoints = {
      deviceAuthorization: resolveProviderEndpoint({
        product: this.product,
        purpose: "authorization",
        value: requiredString(value.device_authorization_endpoint, "XAI_DISCOVERY_INVALID"),
      }),
      token: resolveProviderEndpoint({
        product: this.product,
        purpose: "token_exchange",
        value: requiredString(value.token_endpoint, "XAI_DISCOVERY_INVALID"),
      }),
      revoke: resolveProviderEndpoint({
        product: this.product,
        purpose: "revocation",
        value: requiredString(value.revocation_endpoint, "XAI_DISCOVERY_INVALID"),
      }),
      jwks: resolveProviderEndpoint({
        product: this.product,
        purpose: "identity",
        value: requiredString(value.jwks_uri, "XAI_DISCOVERY_INVALID"),
      }),
    };
    const signingAlgorithms = value.id_token_signing_alg_values_supported;
    if (!Array.isArray(signingAlgorithms) || !signingAlgorithms.includes("ES256")) {
      throw new ProviderProtocolError({
        code: "XAI_DISCOVERY_SIGNING_ALGORITHM_INVALID",
        category: "protocol",
        message: "The xAI discovery document does not support the required ID token algorithm",
      });
    }
    this.discoveredEndpoints = endpoints;
    return endpoints;
  }

  async startDevice(): Promise<DeviceStartResult> {
    try {
      const config = this.config();
      const endpoints = await this.endpoints(config);
      const response = await providerFetch(this.dependencies, endpoints.deviceAuthorization, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": config.userAgent,
        },
        body: formBody({ client_id: config.clientId, scope: config.scopes.join(" ") }),
      });
      const value = await readJsonRecord(response);
      if (!response.ok) throwForHttpStatus(response, "XAI_DEVICE_START_FAILED");
      const verificationUri = resolveProviderEndpoint({
        product: this.product,
        purpose: "authorization",
        value: requiredString(value.verification_uri, "XAI_DEVICE_RESPONSE_INVALID"),
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
        deviceCode: requiredString(value.device_code, "XAI_DEVICE_RESPONSE_INVALID"),
        userCode: requiredString(value.user_code, "XAI_DEVICE_RESPONSE_INVALID"),
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
      const endpoints = await this.endpoints(config);
      const response = await providerFetch(this.dependencies, endpoints.token, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": config.userAgent,
        },
        body: formBody({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          client_id: config.clientId,
          device_code: flow.deviceCode,
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
      if (!response.ok || error) throwForHttpStatus(response, "XAI_DEVICE_POLL_FAILED");
      revocationMaterial = {
        product: this.product,
        refreshToken: requiredString(value.refresh_token, "XAI_REFRESH_TOKEN_MISSING"),
      };
      const bundle = await this.tokenBundle(value, config, endpoints);
      return { status: "connected", product: this.product, bundle };
    } catch (error) {
      return operationFailure(this.product, error, revocationMaterial);
    }
  }

  private async identity(
    value: JsonRecord,
    config: ResolvedXaiConfig,
    endpoints: XaiEndpoints,
  ): Promise<XaiIdentity> {
    const identityToken = requiredString(value.id_token, "XAI_ID_TOKEN_MISSING");
    const response = await providerFetch(this.dependencies, endpoints.jwks, {
      method: "GET",
      headers: { accept: "application/json", "user-agent": config.userAgent },
    });
    const jwks = await readJsonRecord(response);
    if (!response.ok) throwForHttpStatus(response, "XAI_JWKS_FAILED");
    const claims = await verifyOidcIdentityToken(identityToken, jwks, {
      issuer: config.issuer,
      audience: config.clientId,
      algorithms: ["ES256"],
    });
    return { subject: requiredSubject(claims) };
  }

  private async tokenBundle(
    value: JsonRecord,
    config: ResolvedXaiConfig,
    endpoints: XaiEndpoints,
  ): Promise<XaiTokenBundle> {
    const idToken = optionalString(value.id_token);
    return {
      product: this.product,
      accessToken: requiredString(value.access_token, "XAI_ACCESS_TOKEN_MISSING"),
      refreshToken: requiredString(value.refresh_token, "XAI_REFRESH_TOKEN_MISSING"),
      ...(idToken ? { idToken } : {}),
      expiresAtMs: expiresAtMs(this.dependencies.now(), value.expires_in),
      grantedScopes: grantedScopes(value.scope, config.scopes),
      identity: await this.identity(value, config, endpoints),
    };
  }

  async refreshOrRenew(bundle: ProviderTokenBundle): Promise<TokenLifecycleResult> {
    let revocationMaterial: ProviderRevocationMaterial | undefined;
    try {
      assertProduct(this.product, bundle.product);
      const current = bundle as XaiTokenBundle;
      const config = this.config();
      const endpoints = await this.endpoints(config);
      const response = await providerFetch(this.dependencies, endpoints.token, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": config.userAgent,
        },
        body: formBody({
          grant_type: "refresh_token",
          client_id: config.clientId,
          refresh_token: current.refreshToken,
          scope: config.scopes.join(" "),
        }),
      });
      if (response.status === 401 || response.status === 403) {
        return { status: "reauthorization_required", product: this.product, reason: "invalid_grant" };
      }
      const value = await readJsonRecord(response);
      const error = oauthErrorCode(value);
      if (invalidGrantStatus(response.status, error)) {
        return { status: "reauthorization_required", product: this.product, reason: "invalid_grant" };
      }
      if (!response.ok || error) throwForHttpStatus(response, "XAI_REFRESH_FAILED");
      const issuedRefreshToken = optionalString(value.refresh_token);
      const refreshToken = issuedRefreshToken ?? current.refreshToken;
      if (issuedRefreshToken && issuedRefreshToken !== current.refreshToken) {
        revocationMaterial = { product: this.product, refreshToken: issuedRefreshToken };
      }
      const nextScopes = grantedScopes(value.scope, current.grantedScopes, config.scopes);
      const idToken = optionalString(value.id_token) ?? current.idToken;
      let identity = current.identity;
      if (optionalString(value.id_token)) {
        identity = await this.identity(value, config, endpoints);
        if (identity.subject !== current.identity.subject) {
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
      const next: XaiTokenBundle = {
        product: this.product,
        accessToken: requiredString(value.access_token, "XAI_ACCESS_TOKEN_MISSING"),
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
      const endpoints = await this.endpoints(config);
      const response = await providerFetch(this.dependencies, endpoints.revoke, {
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
      if (!response.ok) throwForHttpStatus(response, "XAI_REVOKE_FAILED");
      return { status: "revoked", product: this.product, remote: true };
    } catch (error) {
      return operationFailure(this.product, error);
    }
  }

  async fetchModelCatalog(bundle: ProviderTokenBundle): Promise<ProviderModelCatalogResult> {
    try {
      assertProduct(this.product, bundle.product);
      const current = bundle as XaiTokenBundle;
      const config = this.config();
      const response = await providerFetch(this.dependencies, config.endpoints.models, {
        method: "GET",
        headers: { authorization: `Bearer ${current.accessToken}` },
      });
      if (!response.ok) throwForHttpStatus(response, "XAI_MODEL_CATALOG_FAILED");
      const value = await readJsonRecord(response, {
        maxBytes: MAX_MODEL_CATALOG_RESPONSE_BYTES,
      });
      return {
        status: "ready",
        product: this.product,
        endpoint: config.endpoints.models,
        models: parseXaiModelCatalog(value),
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
          managedHeaderNames: ["authorization", "user-agent", "content-type"],
          buildHeaders: (bundle) => {
            try {
              assertProduct(this.product, bundle.product);
              const current = bundle as XaiTokenBundle;
              return {
                status: "ready",
                headers: new Headers({
                  authorization: `Bearer ${current.accessToken}`,
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
