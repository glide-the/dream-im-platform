// [Input] OIDC ID token, provider JWKS, and the fixed issuer/audience/algorithm verification contract.
// [Output] Signature- and claim-verified identity claims plus product-specific stable identifiers.
// [Pos] OIDC trust boundary; unverified JWT payloads are never accepted as Provider account identity.
// [Sync] 2026-09-04: verify local JWKS signatures, issuer, audience, expiry, and allowed algorithms.

import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { ProviderProtocolError } from "./errors";

export async function verifyOidcIdentityToken(
  token: string,
  jwksValue: Record<string, unknown>,
  input: {
    issuer: string;
    audience: string;
    algorithms: readonly string[];
  },
): Promise<Record<string, unknown>> {
  try {
    const keys = jwksValue.keys;
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > 32) throw new Error();
    const jwks: JSONWebKeySet = {
      keys: keys.map((key) => {
        if (!key || typeof key !== "object" || Array.isArray(key)) throw new Error();
        return key;
      }),
    } as JSONWebKeySet;
    const { payload } = await jwtVerify(token, createLocalJWKSet(jwks), {
      issuer: input.issuer,
      audience: input.audience,
      algorithms: [...input.algorithms],
      requiredClaims: ["sub", "iat", "exp"],
      clockTolerance: 5,
    });
    const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if ((audience.length > 1 || payload.azp !== undefined) && payload.azp !== input.audience) {
      throw new Error();
    }
    return payload as Record<string, unknown>;
  } catch {
    throw new ProviderProtocolError({
      code: "PROVIDER_IDENTITY_TOKEN_INVALID",
      category: "protocol",
      message: "The provider identity token is invalid",
    });
  }
}

export function requiredSubject(claims: Record<string, unknown>): string {
  const subject = claims.sub;
  if (typeof subject !== "string" || subject.trim() === "") {
    throw new ProviderProtocolError({
      code: "PROVIDER_IDENTITY_MISSING",
      category: "protocol",
      message: "The provider token does not contain a stable subject",
    });
  }
  return subject;
}

export function codexAccountId(claims: Record<string, unknown>): string {
  const root = claims.chatgpt_account_id;
  if (typeof root === "string" && root.trim() !== "") return root;
  const namespace = claims["https://api.openai.com/auth"];
  if (namespace && typeof namespace === "object" && !Array.isArray(namespace)) {
    const nested = (namespace as Record<string, unknown>).chatgpt_account_id;
    if (typeof nested === "string" && nested.trim() !== "") return nested;
  }
  throw new ProviderProtocolError({
    code: "CODEX_ACCOUNT_ID_MISSING",
    category: "protocol",
    message: "The Codex token does not contain a ChatGPT account identifier",
  });
}
