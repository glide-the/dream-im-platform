import { GatewayError } from "./errors";

export type AnthropicAuthMode = "x-api-key" | "bearer";

/**
 * Anthropic-compatible relays commonly accept either the native x-api-key
 * header or an Authorization bearer token. Default to the native contract and
 * fail closed on a misspelled/unsupported configured mode.
 */
export function resolveAnthropicAuthMode(
  config: Record<string, unknown>,
): AnthropicAuthMode {
  const mode = config.authMode;
  if (mode === undefined || mode === "x-api-key") return "x-api-key";
  if (mode === "bearer") return "bearer";
  throw new GatewayError(
    "PROVIDER_AUTH_MODE_INVALID",
    "The Anthropic provider authentication mode is invalid",
    503,
    "configuration_error",
  );
}
