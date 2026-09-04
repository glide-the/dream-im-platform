// [Input] Authenticated Provider PATCH candidates, current credential metadata, and deterministic Provider models.
// [Output] A request-memory validation receipt or a stable, audited Admin failure with no credential disclosure.
// [Pos] Provider static-credential lifecycle boundary used before the final PostgreSQL revision CAS.
// [Sync] 2026-09-04: validate credential-sensitive updates before replacing the effective encrypted credential.

import type { PoolClient } from "pg";

import { GatewayError } from "../gateway/errors";
import { withPlatformClient, withPlatformTransaction } from "../platform-db";
import { modelRequestHeadersSchema } from "../models/request-headers";
import { decryptCredential } from "../security/credential-encryption";
import { recordAdminAuditOnClient } from "./audit";
import { AdminError } from "./errors";
import { validateUpstreamModel } from "./model-validation";
import type { AdminIdentity } from "./session";

type ProviderProtocol = "anthropic" | "openai";

export type ProviderCredentialUpdateInput = {
  apiKey?: string;
  baseUrl?: string;
  config?: Record<string, unknown>;
  expectedAuthRevision?: number;
  status?: "active" | "disabled";
  timeoutMs?: number;
};

type ProviderCredentialState = {
  id: string;
  code: string;
  protocol: ProviderProtocol;
  base_url: string;
  status: "active" | "disabled";
  timeout_ms: number;
  config: Record<string, unknown> | null;
  auth_revision: number;
  api_key_ciphertext: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  model_id: string | null;
  model_code: string | null;
  upstream_model: string | null;
  request_headers: unknown;
};

export type PreparedProviderCredentialUpdate =
  | { sensitive: false }
  | {
      sensitive: true;
      expectedAuthRevision: number;
      validatedAt: Date;
      validationModelCode: string;
    };

type FailureAudit = {
  code: string;
  expectedAuthRevision?: number;
  currentAuthRevision: number;
  modelCode?: string | null;
  validationStatus?: string;
  httpStatus?: number | null;
};

async function recordFailure(input: {
  provider: Pick<ProviderCredentialState, "id" | "code" | "auth_revision">;
  identity: AdminIdentity;
  request: Request;
  requestId: string;
  failure: FailureAudit;
}) {
  await withPlatformTransaction(async (client) => {
    await recordAdminAuditOnClient(client, {
      identity: input.identity,
      action: "credential_validation_failed",
      resourceType: "providers",
      resourceId: input.provider.id,
      requestId: input.requestId,
      request: input.request,
      metadata: {
        providerCode: input.provider.code,
        failureCode: input.failure.code,
        expectedAuthRevision: input.failure.expectedAuthRevision,
        currentAuthRevision: input.failure.currentAuthRevision,
        modelCode: input.failure.modelCode ?? undefined,
        validationStatus: input.failure.validationStatus,
        httpStatus: input.failure.httpStatus,
      },
    });
  });
}

async function failAfterAudit(input: {
  provider: ProviderCredentialState;
  identity: AdminIdentity;
  request: Request;
  requestId: string;
  error: AdminError;
  failure: FailureAudit;
}): Promise<never> {
  await recordFailure(input);
  throw input.error;
}

async function loadProviderCredentialState(
  client: PoolClient,
  providerId: string,
) {
  const { rows } = await client.query<ProviderCredentialState>(
    `SELECT p.id, p.code, p.protocol, p.base_url, p.status, p.timeout_ms,
            p.config, p.auth_revision, p.api_key_ciphertext, p.api_key_iv,
            p.api_key_tag, model.id AS model_id, model.code AS model_code,
            model.upstream_model, model.request_headers
       FROM ai_providers AS p
       LEFT JOIN LATERAL (
         SELECT m.id, m.code, m.upstream_model, m.request_headers
           FROM ai_models AS m
          WHERE m.provider_id = p.id
          ORDER BY m.enabled DESC, m.code ASC, m.id ASC
          LIMIT 1
       ) AS model ON TRUE
      WHERE p.id = $1`,
    [providerId],
  );
  if (!rows[0]) {
    throw new AdminError(
      "ADMIN_RESOURCE_ITEM_NOT_FOUND",
      "The requested providers item does not exist",
      404,
    );
  }
  return rows[0];
}

function isCredentialSensitive(
  provider: ProviderCredentialState,
  input: ProviderCredentialUpdateInput,
) {
  const normalizeBaseUrl = (value: string) => {
    try {
      const url = new URL(value);
      url.pathname = url.pathname.replace(/\/+$/, "");
      return url.toString().replace(/\/$/, "");
    } catch {
      return value.trim();
    }
  };
  const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) {
      return `[${value.map(canonicalJson).join(",")}]`;
    }
    if (value !== null && typeof value === "object") {
      return `{${Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
        .join(",")}}`;
    }
    return JSON.stringify(value) ?? "__undefined__";
  };
  const baseUrlChanged = input.baseUrl !== undefined
    && normalizeBaseUrl(input.baseUrl) !== normalizeBaseUrl(provider.base_url);
  const currentConfig = provider.config ?? {};
  const effectiveAuthMode = (config: Record<string, unknown>) => {
    const mode = config.authMode;
    if (provider.protocol === "openai") {
      return mode === undefined || mode === "bearer"
        ? "bearer"
        : `invalid:${canonicalJson(mode)}`;
    }
    if (mode === undefined || mode === "x-api-key") return "x-api-key";
    if (mode === "bearer") return "bearer";
    return `invalid:${canonicalJson(mode)}`;
  };
  const effectiveOutputTokenParam = (config: Record<string, unknown>) =>
    config.outputTokenParam === "max_completion_tokens"
      ? "max_completion_tokens"
      : "max_tokens";
  const configChanged = input.config !== undefined
    && (
      effectiveAuthMode(input.config) !== effectiveAuthMode(currentConfig)
      || effectiveOutputTokenParam(input.config)
        !== effectiveOutputTokenParam(currentConfig)
    );
  return input.apiKey !== undefined
    || baseUrlChanged
    || configChanged
    || (input.status === "active" && provider.status !== "active");
}

/**
 * Keeps the candidate credential in request memory and performs no Provider
 * mutation. The caller must apply the receipt in a later row-locked revision
 * CAS so concurrent Admin writes cannot publish stale validation evidence.
 */
export async function prepareProviderCredentialUpdate(input: {
  providerId: string;
  update: ProviderCredentialUpdateInput;
  identity: AdminIdentity;
  request: Request;
  requestId: string;
}): Promise<PreparedProviderCredentialUpdate> {
  const provider = await withPlatformClient((client) =>
    loadProviderCredentialState(client, input.providerId),
  );
  if (!isCredentialSensitive(provider, input.update)) {
    return { sensitive: false };
  }

  const expectedAuthRevision = input.update.expectedAuthRevision;
  if (expectedAuthRevision === undefined) {
    return await failAfterAudit({
      provider,
      identity: input.identity,
      request: input.request,
      requestId: input.requestId,
      error: new AdminError(
        "PROVIDER_AUTH_REVISION_REQUIRED",
        "A credential-sensitive Provider update requires expectedAuthRevision",
        400,
      ),
      failure: {
        code: "PROVIDER_AUTH_REVISION_REQUIRED",
        currentAuthRevision: provider.auth_revision,
      },
    });
  }
  if (provider.auth_revision !== expectedAuthRevision) {
    return await failAfterAudit({
      provider,
      identity: input.identity,
      request: input.request,
      requestId: input.requestId,
      error: new AdminError(
        "PROVIDER_AUTH_REVISION_CONFLICT",
        "The Provider authentication revision has changed",
        409,
      ),
      failure: {
        code: "PROVIDER_AUTH_REVISION_CONFLICT",
        expectedAuthRevision,
        currentAuthRevision: provider.auth_revision,
      },
    });
  }
  if (!provider.model_id || !provider.model_code || !provider.upstream_model) {
    return await failAfterAudit({
      provider,
      identity: input.identity,
      request: input.request,
      requestId: input.requestId,
      error: new AdminError(
        "PROVIDER_VALIDATION_MODEL_REQUIRED",
        "The Provider requires a model before its credential can be validated",
        409,
      ),
      failure: {
        code: "PROVIDER_VALIDATION_MODEL_REQUIRED",
        expectedAuthRevision,
        currentAuthRevision: provider.auth_revision,
      },
    });
  }

  const requestHeaders = modelRequestHeadersSchema.safeParse(
    provider.request_headers ?? {},
  );
  if (!requestHeaders.success) {
    return await failAfterAudit({
      provider,
      identity: input.identity,
      request: input.request,
      requestId: input.requestId,
      error: new AdminError(
        "PROVIDER_VALIDATION_MODEL_INVALID",
        "The Provider validation model has invalid request headers",
        409,
      ),
      failure: {
        code: "PROVIDER_VALIDATION_MODEL_INVALID",
        expectedAuthRevision,
        currentAuthRevision: provider.auth_revision,
        modelCode: provider.model_code,
      },
    });
  }

  let credential = input.update.apiKey;
  if (!credential) {
    if (
      !provider.api_key_ciphertext
      || !provider.api_key_iv
      || !provider.api_key_tag
    ) {
      return await failAfterAudit({
        provider,
        identity: input.identity,
        request: input.request,
        requestId: input.requestId,
        error: new AdminError(
          "PROVIDER_CREDENTIAL_REQUIRED",
          "The Provider has no credential to validate",
          409,
        ),
        failure: {
          code: "PROVIDER_CREDENTIAL_REQUIRED",
          expectedAuthRevision,
          currentAuthRevision: provider.auth_revision,
          modelCode: provider.model_code,
        },
      });
    }
    try {
      credential = decryptCredential({
        ciphertext: provider.api_key_ciphertext,
        iv: provider.api_key_iv,
        tag: provider.api_key_tag,
      });
    } catch {
      return await failAfterAudit({
        provider,
        identity: input.identity,
        request: input.request,
        requestId: input.requestId,
        error: new AdminError(
          "PROVIDER_CREDENTIAL_UNAVAILABLE",
          "The Provider credential could not be used for validation",
          409,
        ),
        failure: {
          code: "PROVIDER_CREDENTIAL_UNAVAILABLE",
          expectedAuthRevision,
          currentAuthRevision: provider.auth_revision,
          modelCode: provider.model_code,
        },
      });
    }
  }

  let validation;
  try {
    validation = await validateUpstreamModel({
      protocol: provider.protocol,
      baseUrl: input.update.baseUrl ?? provider.base_url,
      upstreamModel: provider.upstream_model,
      credential,
      config: input.update.config ?? provider.config ?? {},
      requestHeaders: requestHeaders.data,
      timeoutMs: input.update.timeoutMs ?? provider.timeout_ms,
    });
  } catch (error) {
    if (!(error instanceof GatewayError)) throw error;
    return await failAfterAudit({
      provider,
      identity: input.identity,
      request: input.request,
      requestId: input.requestId,
      error: new AdminError(
        error.code,
        "The Provider authentication configuration is invalid",
        409,
      ),
      failure: {
        code: error.code,
        expectedAuthRevision,
        currentAuthRevision: provider.auth_revision,
        modelCode: provider.model_code,
      },
    });
  }

  if (
    !validation.usable
    || validation.httpStatus === null
    || validation.httpStatus < 200
    || validation.httpStatus >= 300
  ) {
    const retryable = validation.httpStatus === null
      || validation.httpStatus === 408
      || validation.httpStatus === 429
      || validation.httpStatus >= 500;
    return await failAfterAudit({
      provider,
      identity: input.identity,
      request: input.request,
      requestId: input.requestId,
      error: new AdminError(
        "PROVIDER_CREDENTIAL_VALIDATION_FAILED",
        "The Provider credential did not pass upstream model validation",
        retryable ? 503 : 409,
        {
          validationStatus: validation.status,
          httpStatus: validation.httpStatus,
          modelCode: provider.model_code,
        },
      ),
      failure: {
        code: "PROVIDER_CREDENTIAL_VALIDATION_FAILED",
        expectedAuthRevision,
        currentAuthRevision: provider.auth_revision,
        modelCode: provider.model_code,
        validationStatus: validation.status,
        httpStatus: validation.httpStatus,
      },
    });
  }

  return {
    sensitive: true,
    expectedAuthRevision,
    validatedAt: new Date(validation.testedAt),
    validationModelCode: provider.model_code,
  };
}

export async function recordProviderCredentialRevisionConflict(input: {
  providerId: string;
  providerCode: string;
  currentAuthRevision: number;
  expectedAuthRevision: number;
  validationModelCode: string;
  identity: AdminIdentity;
  request: Request;
  requestId: string;
}) {
  await recordFailure({
    provider: {
      id: input.providerId,
      code: input.providerCode,
      auth_revision: input.currentAuthRevision,
    },
    identity: input.identity,
    request: input.request,
    requestId: input.requestId,
    failure: {
      code: "PROVIDER_AUTH_REVISION_CONFLICT",
      expectedAuthRevision: input.expectedAuthRevision,
      currentAuthRevision: input.currentAuthRevision,
      modelCode: input.validationModelCode,
    },
  });
}
