// [Input] Admin-issued RFC9068 access token, configured issuer/resource and public signing keys.
// [Output] Verified immutable OAuth identity/scopes; canonical mapping stays in the subject repository.
// [Pos] Shared Product/Dream/Gateway verifier; Google, ID and Session tokens cannot pass.
// [Sync] 2026-09-14: verify ES256 at+jwt with exact lifetime and no token-controlled network fetch.
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { accessTokenLifetimeSeconds, AuthBoundaryError, authConfiguration } from "./config";
import { authDatabase, type AuthRepositoryDatabase } from "./database";
import { jwks } from "@ink-memory/db/schema/auth-generated";

export type VerifiedAdminAccessToken = { subject: string; clientId: string; tokenId: string; scopes: string[] };
type AccessTokenDependencies = {
  configuration?: { issuer: string; resource: string };
  keys?: JSONWebKeySet;
};

export async function adminPublicKeys(database: AuthRepositoryDatabase = authDatabase()): Promise<JSONWebKeySet> {
  const rows = await database.select({ publicKey: jwks.publicKey, id: jwks.id, alg: jwks.alg }).from(jwks);
  try {
    return { keys: rows.map(row => ({ ...JSON.parse(row.publicKey), kid: row.id, alg: row.alg ?? "ES256", use: "sig" })) };
  } catch { throw new AuthBoundaryError("AUTH_SIGNING_KEYS_UNAVAILABLE"); }
}

export async function verifyAdminAccessToken(headers: Headers, requiredScope: string, dependencies: AccessTokenDependencies = {}): Promise<VerifiedAdminAccessToken> {
  const match = headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match || match[1].length > 16_384) throw new AuthBoundaryError("ACCESS_TOKEN_REQUIRED", 401);
  const configuration = dependencies.configuration ?? authConfiguration();
  const keys = dependencies.keys ?? await adminPublicKeys();
  try {
    const { payload, protectedHeader } = await jwtVerify(match[1], createLocalJWKSet(keys), {
      algorithms: ["ES256"], issuer: configuration.issuer, audience: configuration.resource,
      typ: "at+jwt", requiredClaims: ["sub", "iat", "exp", "jti", "client_id", "scope"],
      maxTokenAge: `${accessTokenLifetimeSeconds}s`, clockTolerance: 5,
    });
    if (protectedHeader.typ !== "at+jwt" || typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 160 ||
        typeof payload.jti !== "string" || !payload.jti || payload.jti.length > 200 ||
        typeof payload.client_id !== "string" || !payload.client_id || payload.client_id.length > 160 ||
        !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) ||
        payload.exp! <= payload.iat! || payload.exp! - payload.iat! > accessTokenLifetimeSeconds ||
        typeof payload.scope !== "string" || payload.scope.length > 1_000 || payload.cnf) throw new Error("invalid access token");
    const scopes = [...new Set(payload.scope.split(/\s+/).filter(Boolean))];
    if (!scopes.length || scopes.some(scope => !/^[a-z][a-z0-9:*._-]{1,79}$/.test(scope))) throw new Error("invalid scope");
    if (!scopes.includes(requiredScope)) throw new AuthBoundaryError("ACCESS_SCOPE_REQUIRED", 403);
    return { subject: payload.sub, clientId: payload.client_id, tokenId: payload.jti, scopes };
  } catch (error) {
    if (error instanceof AuthBoundaryError) throw error;
    throw new AuthBoundaryError("ACCESS_TOKEN_REQUIRED", 401);
  }
}
