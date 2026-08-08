import Anthropic, { APIError as AnthropicAPIError } from "@anthropic-ai/sdk";
import OpenAI, { APIError as OpenAIAPIError } from "openai";
import type { ResolvedBillableModel } from "../models/resolver";
import { decryptCredential } from "../security/credential-encryption";
import { GatewayError } from "./errors";
import { resolveProviderBaseUrl } from "./provider-endpoint";
import { resolveAnthropicAuthMode } from "./provider-auth";

function credential(resolved: ResolvedBillableModel) {
  try {
    return decryptCredential(resolved.provider.encryptedCredential);
  } catch {
    throw new GatewayError(
      "PROVIDER_CREDENTIAL_UNAVAILABLE",
      "The selected provider credential could not be decrypted",
      503,
      "configuration_error",
    );
  }
}

export function createAnthropicProviderClient(
  resolved: ResolvedBillableModel,
) {
  if (resolved.provider.protocol !== "anthropic") {
    throw new GatewayError(
      "MODEL_PROTOCOL_MISMATCH",
      "The selected provider does not support the Anthropic protocol",
      503,
      "configuration_error",
    );
  }
  const secret = credential(resolved);
  const authMode = resolveAnthropicAuthMode(resolved.provider.config);
  return new Anthropic({
    apiKey: authMode === "x-api-key" ? secret : null,
    authToken: authMode === "bearer" ? secret : null,
    baseURL: resolveProviderBaseUrl({
      protocol: "anthropic",
      baseUrl: resolved.provider.baseUrl,
    }),
    timeout: resolved.provider.timeoutMs,
    maxRetries: resolved.provider.maxRetries,
  });
}

export function createOpenAIProviderClient(resolved: ResolvedBillableModel) {
  if (resolved.provider.protocol !== "openai") {
    throw new GatewayError(
      "MODEL_PROTOCOL_MISMATCH",
      "The selected provider does not support the OpenAI protocol",
      503,
      "configuration_error",
    );
  }
  return new OpenAI({
    apiKey: credential(resolved),
    baseURL: resolveProviderBaseUrl({
      protocol: "openai",
      baseUrl: resolved.provider.baseUrl,
    }),
    timeout: resolved.provider.timeoutMs,
    maxRetries: resolved.provider.maxRetries,
  });
}

type ProviderApiError = AnthropicAPIError | OpenAIAPIError;

function isProviderApiError(error: unknown): error is ProviderApiError {
  return error instanceof AnthropicAPIError || error instanceof OpenAIAPIError;
}

export function providerRequestId(error: unknown) {
  return isProviderApiError(error) ? error.requestID ?? undefined : undefined;
}

export function toProviderGatewayError(error: unknown) {
  if (error instanceof GatewayError) return error;
  if (!isProviderApiError(error)) {
    return new GatewayError(
      "UPSTREAM_CONNECTION_ERROR",
      "The upstream model provider could not be reached",
      502,
      "upstream_error",
      true,
    );
  }

  const status = error.status;
  if (status === 429) {
    return new GatewayError(
      "UPSTREAM_RATE_LIMITED",
      "The upstream model provider is rate limited",
      429,
      "rate_limit_error",
      true,
    );
  }
  if (status === 400 || status === 404 || status === 422) {
    return new GatewayError(
      "UPSTREAM_REQUEST_REJECTED",
      "The upstream model provider rejected the request",
      status === 404 ? 400 : status,
      "invalid_request_error",
    );
  }
  if (status === 401 || status === 403) {
    return new GatewayError(
      "UPSTREAM_CREDENTIAL_REJECTED",
      "The upstream model provider rejected its configured credential",
      502,
      "upstream_error",
    );
  }
  return new GatewayError(
    "UPSTREAM_ERROR",
    "The upstream model provider could not complete the request",
    502,
    "upstream_error",
    status === undefined || status >= 500,
  );
}
