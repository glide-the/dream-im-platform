import { jwtVerify, type JWTPayload } from "jose";
import type { PoolClient } from "pg";
import { ProductError } from "./errors";
import {
  findProductIdentityOnClient,
  type ProductIdentityRow,
} from "./repository";
import { assertNoProductUserOverride } from "./request";
import type { ProductPrincipal } from "./types";
import {
  withProductReadUnitOfWork,
  type ProductReadUnitOfWork,
} from "./uow";

const maximumTokenLifetimeSeconds = 300;
const clockToleranceSeconds = 5;
const postgresBigintMaximum = 9_223_372_036_854_775_807n;

type ProductJwtConfiguration = {
  secret: Uint8Array;
  issuer: string;
  audience: string;
};

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ProductError(
      "PRODUCT_AUTH_NOT_CONFIGURED",
      "Product API authentication is not configured",
      503,
    );
  }
  return value;
}

function productJwtConfiguration(): ProductJwtConfiguration {
  const secretValue = requiredEnvironment("PRODUCT_API_JWT_SECRET");
  const secret = new TextEncoder().encode(secretValue);
  if (secret.byteLength < 32) {
    throw new ProductError(
      "PRODUCT_AUTH_NOT_CONFIGURED",
      "Product API authentication is not configured",
      503,
    );
  }
  return {
    secret,
    issuer: requiredEnvironment("PRODUCT_API_JWT_ISSUER"),
    audience: requiredEnvironment("PRODUCT_API_JWT_AUDIENCE"),
  };
}

function bearerToken(headers: Headers) {
  const authorization = headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match) {
    throw new ProductError(
      "PRODUCT_AUTH_REQUIRED",
      "A valid Product API Bearer token is required",
      401,
    );
  }
  return match[1];
}

function canonicalSubject(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) {
    throw new ProductError(
      "PRODUCT_AUTH_REQUIRED",
      "A valid Product API Bearer token is required",
      401,
    );
  }
  const parsed = BigInt(value);
  if (parsed > postgresBigintMaximum) {
    throw new ProductError(
      "PRODUCT_AUTH_REQUIRED",
      "A valid Product API Bearer token is required",
      401,
    );
  }
  return value;
}

function stringClaim(value: unknown, maximumLength: number) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
    ? value
    : null;
}

function tokenScopes(payload: JWTPayload) {
  const scopeClaim = payload.scope;
  if (typeof scopeClaim !== "string" || scopeClaim.length > 1_000) {
    throw new ProductError(
      "PRODUCT_AUTH_REQUIRED",
      "A valid Product API Bearer token is required",
      401,
    );
  }
  const scopes: string[] = scopeClaim.split(/\s+/).filter(Boolean);
  if (
    scopes.length === 0 ||
    scopes.some((scope) => !/^[a-z][a-z0-9:*._-]{1,79}$/.test(scope))
  ) {
    throw new ProductError(
      "PRODUCT_AUTH_REQUIRED",
      "A valid Product API Bearer token is required",
      401,
    );
  }
  return [...new Set<string>(scopes)];
}

export type VerifiedProductToken = {
  canonicalUserId: string;
  clientId: string;
  tokenId: string;
  scopes: string[];
};

export async function verifyProductJwt(
  headers: Headers,
  requiredScope: "product:read" | "product:write",
): Promise<VerifiedProductToken> {
  const token = bearerToken(headers);
  const configuration = productJwtConfiguration();
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, configuration.secret, {
      algorithms: ["HS256"],
      issuer: configuration.issuer,
      audience: configuration.audience,
      requiredClaims: ["sub", "iat", "exp", "jti", "scope"],
      clockTolerance: clockToleranceSeconds,
      maxTokenAge: `${maximumTokenLifetimeSeconds}s`,
    }));
  } catch {
    throw new ProductError(
      "PRODUCT_AUTH_REQUIRED",
      "A valid Product API Bearer token is required",
      401,
    );
  }
  if (
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > maximumTokenLifetimeSeconds
  ) {
    throw new ProductError(
      "PRODUCT_AUTH_REQUIRED",
      "A valid Product API Bearer token is required",
      401,
    );
  }
  const canonicalUserId = canonicalSubject(payload.sub);
  const clientIdClaim = stringClaim(payload.client_id, 160);
  const authorizedParty = stringClaim(payload.azp, 160);
  if (clientIdClaim && authorizedParty && clientIdClaim !== authorizedParty) {
    throw new ProductError(
      "PRODUCT_AUTH_REQUIRED",
      "A valid Product API Bearer token is required",
      401,
    );
  }
  const clientId = clientIdClaim ?? authorizedParty;
  const tokenId = stringClaim(payload.jti, 200);
  if (!clientId || !tokenId) {
    throw new ProductError(
      "PRODUCT_AUTH_REQUIRED",
      "A valid Product API Bearer token is required",
      401,
    );
  }
  const scopes = tokenScopes(payload);
  if (!scopes.includes(requiredScope)) {
    throw new ProductError(
      "PRODUCT_SCOPE_REQUIRED",
      `The Product API token does not grant ${requiredScope}`,
      403,
    );
  }
  return { canonicalUserId, clientId, tokenId, scopes };
}

type ProductAuthDependencies = {
  verifyToken?: typeof verifyProductJwt;
  readUnitOfWork?: ProductReadUnitOfWork;
  findIdentity?: (
    client: PoolClient,
    canonicalUserId: string,
  ) => Promise<ProductIdentityRow | null>;
};

export async function requireProductPrincipal(
  request: Request,
  requiredScope: "product:read" | "product:write",
  dependencies: ProductAuthDependencies = {},
): Promise<ProductPrincipal> {
  assertNoProductUserOverride(request);
  const verified = await (dependencies.verifyToken ?? verifyProductJwt)(
    request.headers,
    requiredScope,
  );
  const identity = await (
    dependencies.readUnitOfWork ?? withProductReadUnitOfWork
  )(async (client) =>
    await (dependencies.findIdentity ?? findProductIdentityOnClient)(
      client,
      verified.canonicalUserId,
    ),
  );
  if (!identity?.canonical_user_id) {
    throw new ProductError(
      "CANONICAL_USER_REQUIRED",
      "The authenticated subject is not an active canonical user",
      403,
    );
  }
  if (
    !identity.platform_user_id ||
    identity.platform_status !== "active" ||
    !identity.tier
  ) {
    throw new ProductError(
      "CANONICAL_USER_REQUIRED",
      "The authenticated canonical user has no active platform projection",
      403,
    );
  }
  return {
    ...verified,
    platformUserId: identity.platform_user_id,
    tier: identity.tier,
  };
}
