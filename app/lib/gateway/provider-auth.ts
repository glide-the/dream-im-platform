// [Input] Provider protocol plus persisted, non-secret provider configuration.
// [Output] One explicit static credential header mode or a fail-closed GatewayError.
// [Pos] Shared authentication-mode resolver for Admin validation and Gateway transports.
// [Sync] 2026-09-04: unify OpenAI bearer-only and Anthropic x-api-key/bearer resolution.

import { GatewayError } from "./errors";

export type ProviderAuthMode = "x-api-key" | "bearer";

type ProviderAuthInput = {
  protocol: "anthropic" | "openai";
  config: Record<string, unknown>;
};

function invalidAuthMode(protocol: string): never {
  throw new GatewayError(
    "PROVIDER_AUTH_MODE_INVALID",
    `The ${protocol} provider authentication mode is invalid`,
    503,
    "configuration_error",
  );
}

/**
 * Resolves the only static credential header modes supported by each protocol.
 * OpenAI-compatible providers always use Bearer while Anthropic-compatible
 * providers default to their native x-api-key contract.
 */
export function resolveProviderAuthMode(
  input: ProviderAuthInput,
): ProviderAuthMode {
  const mode = input.config.authMode;
  if (input.protocol === "openai") {
    if (mode === undefined || mode === "bearer") return "bearer";
    return invalidAuthMode(input.protocol);
  }
  if (input.protocol === "anthropic") {
    if (mode === undefined || mode === "x-api-key") return "x-api-key";
    if (mode === "bearer") return "bearer";
    return invalidAuthMode(input.protocol);
  }
  return invalidAuthMode(String(input.protocol));
}

/**
 * Anthropic-compatible relays commonly accept either the native x-api-key
 * header or an Authorization bearer token. Default to the native contract and
 * fail closed on a misspelled/unsupported configured mode.
 */
export function resolveAnthropicAuthMode(
  config: Record<string, unknown>,
): ProviderAuthMode {
  return resolveProviderAuthMode({ protocol: "anthropic", config });
}
