// [Input] Locally signed OIDC tokens and matching or adversarial JWKS/claim contracts.
// [Output] Regression proof that only signed, current, issuer/audience-bound identities are accepted.
// [Pos] Unit security contract for the Provider OIDC identity verification boundary.
// [Sync] 2026-09-04: reject forged signatures and mismatched issuer/audience without leaking token data.

import { generateKeyPairSync } from "node:crypto";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import { verifyOidcIdentityToken } from "./jwt";

const trusted = generateKeyPairSync("ec", { namedCurve: "P-256" });
const attacker = generateKeyPairSync("ec", { namedCurve: "P-256" });
const trustedJwk = {
  ...trusted.publicKey.export({ format: "jwk" }),
  kid: "trusted",
  alg: "ES256",
  use: "sig",
};
const attackerJwk = {
  ...attacker.publicKey.export({ format: "jwk" }),
  kid: "trusted",
  alg: "ES256",
  use: "sig",
};

async function token(
  overrides: {
    issuer?: string;
    audience?: string | string[];
    authorizedParty?: string;
    attacker?: boolean;
    omitIssuedAt?: boolean;
    omitExpiration?: boolean;
  } = {},
) {
  let builder = new SignJWT({
    sub: "account-1",
    ...(overrides.authorizedParty === undefined ? {} : { azp: overrides.authorizedParty }),
  })
    .setProtectedHeader({ alg: "ES256", kid: "trusted" })
    .setIssuer(overrides.issuer ?? "https://auth.x.ai")
    .setAudience(overrides.audience ?? "ink-client");
  if (!overrides.omitIssuedAt) builder = builder.setIssuedAt();
  if (!overrides.omitExpiration) builder = builder.setExpirationTime("1h");
  return await builder.sign(overrides.attacker ? attacker.privateKey : trusted.privateKey);
}

const verification = {
  issuer: "https://auth.x.ai",
  audience: "ink-client",
  algorithms: ["ES256"],
} as const;

describe("Provider OIDC identity verification", () => {
  it("accepts a correctly signed issuer/audience-bound token", async () => {
    await expect(verifyOidcIdentityToken(
      await token(),
      { keys: [trustedJwk] },
      verification,
    )).resolves.toMatchObject({ sub: "account-1" });
  });

  it.each([
    ["forged signature", { attacker: true }, { keys: [trustedJwk] }],
    ["wrong issuer", { issuer: "https://attacker.invalid" }, { keys: [trustedJwk] }],
    ["wrong audience", { audience: "other-client" }, { keys: [trustedJwk] }],
    ["untrusted JWKS", {}, { keys: [attackerJwk] }],
  ])("rejects %s with one secret-free error", async (_label, overrides, jwks) => {
    const raw = await token(overrides);
    const result = verifyOidcIdentityToken(raw, jwks, verification);
    await expect(result).rejects.toMatchObject({
      code: "PROVIDER_IDENTITY_TOKEN_INVALID",
      category: "protocol",
    });
    await expect(result).rejects.not.toThrow(raw);
  });

  it("requires issued-at and expiration claims", async () => {
    await expect(verifyOidcIdentityToken(
      await token({ omitIssuedAt: true }),
      { keys: [trustedJwk] },
      verification,
    )).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_TOKEN_INVALID" });
    await expect(verifyOidcIdentityToken(
      await token({ omitExpiration: true }),
      { keys: [trustedJwk] },
      verification,
    )).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_TOKEN_INVALID" });
  });

  it("requires azp to identify this client for multi-audience tokens", async () => {
    await expect(verifyOidcIdentityToken(
      await token({ audience: ["ink-client", "resource-api"], authorizedParty: "ink-client" }),
      { keys: [trustedJwk] },
      verification,
    )).resolves.toMatchObject({ sub: "account-1", azp: "ink-client" });
    await expect(verifyOidcIdentityToken(
      await token({ audience: ["ink-client", "resource-api"], authorizedParty: "other-client" }),
      { keys: [trustedJwk] },
      verification,
    )).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_TOKEN_INVALID" });
  });

  it("rejects a mismatched azp even when the token has one audience", async () => {
    await expect(verifyOidcIdentityToken(
      await token({ authorizedParty: "other-client" }),
      { keys: [trustedJwk] },
      verification,
    )).rejects.toMatchObject({ code: "PROVIDER_IDENTITY_TOKEN_INVALID" });
  });
});
