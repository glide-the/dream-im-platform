import { createHmac, randomBytes } from "node:crypto";

const GATEWAY_KEY_PREFIX = "gw_";

export class GatewayKeyConfigurationError extends Error {
  readonly code = "GATEWAY_KEY_PEPPER_NOT_CONFIGURED";

  constructor() {
    super("GATEWAY_API_KEY_PEPPER must be configured before API keys can be used");
    this.name = "GatewayKeyConfigurationError";
  }
}

export function getGatewayKeyPepper() {
  const pepper = process.env.GATEWAY_API_KEY_PEPPER;
  if (!pepper || Buffer.byteLength(pepper, "utf8") < 32) {
    throw new GatewayKeyConfigurationError();
  }
  return pepper;
}

export function hashGatewayApiKey(
  plaintext: string,
  pepper = getGatewayKeyPepper(),
) {
  if (!plaintext.startsWith(GATEWAY_KEY_PREFIX)) {
    throw new RangeError("Gateway API key has an invalid prefix");
  }
  return createHmac("sha256", pepper).update(plaintext, "utf8").digest("hex");
}

export function createGatewayApiKey(pepper = getGatewayKeyPepper()) {
  const plaintext = `${GATEWAY_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return {
    plaintext,
    prefix: plaintext.slice(0, 12),
    hash: hashGatewayApiKey(plaintext, pepper),
  };
}

export function extractGatewayApiKey(headers: Headers) {
  const authorization = headers.get("authorization")?.trim();
  if (authorization?.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    if (token.startsWith(GATEWAY_KEY_PREFIX)) return token;
  }
  const anthropicKey = headers.get("x-api-key")?.trim();
  return anthropicKey?.startsWith(GATEWAY_KEY_PREFIX)
    ? anthropicKey
    : null;
}
