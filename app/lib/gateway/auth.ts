import { jwtVerify, type JWTPayload } from "jose";
import type { PoolClient } from "pg";
import { withPlatformClient } from "../platform-db";
import { extractGatewayApiKey, hashGatewayApiKey } from "./api-keys";
import { GatewayError } from "./errors";

const maximumSubjectTokenLifetimeSeconds = 300;
const subjectTokenClockToleranceSeconds = 5;
const postgresBigintMaximum = 9_223_372_036_854_775_807n;

export type GatewayPrincipal = {
  apiKeyId: string;
  platformUserId: string;
  source: string;
  externalUserId: string;
  tier: string;
  scopes: string[];
  dailyTokenLimit?: number;
  monthlyTokenLimit?: number;
};

type GatewaySubjectMode = "fixed_user" | "canonical_subject";

type GatewayKeyRow = {
  api_key_id: string;
  platform_user_id: string | null;
  subject_mode: GatewaySubjectMode | null;
  service_client_id: string | null;
  scopes: string[];
  canonical_user_id: string | null;
  source: string | null;
  external_user_id: string | null;
  tier: string | null;
  daily_token_limit: string | number | null;
  monthly_token_limit: string | number | null;
};

type GatewayIdentityRow = {
  canonical_user_id: string;
  platform_user_id: string;
  source: string;
  external_user_id: string;
  tier: string;
  daily_token_limit: string | number | null;
  monthly_token_limit: string | number | null;
};

type VerifiedGatewaySubject = {
  canonicalUserId: string;
  clientId: string;
  tokenId: string;
  scopes: string[];
};

function authenticationError(
  code = "GATEWAY_SUBJECT_TOKEN_INVALID",
  message = "A valid Gateway subject token is required",
) {
  return new GatewayError(code, message, 401, "authentication_error");
}

function configurationError() {
  return new GatewayError(
    "GATEWAY_AUTH_NOT_CONFIGURED",
    "Gateway authentication is not configured",
    503,
    "configuration_error",
  );
}

function optionalSafeNumber(value: string | number | null, name: string) {
  if (value === null) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new GatewayError(
      "INVALID_ACCOUNT_LIMIT",
      `Configured ${name} is invalid`,
      503,
      "configuration_error",
    );
  }
  return parsed;
}

function requiredSubjectEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw configurationError();
  return value;
}

function bearerSubjectToken(headers: Headers) {
  const authorization = headers.get("authorization")?.trim();
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  if (!match || match[1].startsWith("gw_")) {
    throw authenticationError(
      "GATEWAY_SUBJECT_TOKEN_REQUIRED",
      "A Gateway subject Bearer token is required for this service key",
    );
  }
  return match[1];
}

function canonicalSubject(value: unknown) {
  if (typeof value !== "string" || !/^[1-9]\d{0,18}$/.test(value)) {
    throw authenticationError();
  }
  const parsed = BigInt(value);
  if (parsed > postgresBigintMaximum) throw authenticationError();
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
    throw authenticationError();
  }
  const scopes = scopeClaim.split(/\s+/).filter(Boolean);
  if (
    scopes.length === 0 ||
    scopes.some((scope) => !/^[a-z][a-z0-9:*._-]{1,79}$/.test(scope))
  ) {
    throw authenticationError();
  }
  return [...new Set(scopes)];
}

function assertNoSubjectHeaderOverride(headers: Headers) {
  const forbiddenHeaders = [
    "x-canonical-user-id",
    "x-platform-user-id",
    "x-external-user-id",
    "x-user-id",
  ];
  if (forbiddenHeaders.some((name) => headers.has(name))) {
    throw new GatewayError(
      "GATEWAY_SUBJECT_OVERRIDE_FORBIDDEN",
      "Gateway user identity must not be supplied through request headers",
      400,
      "invalid_request_error",
    );
  }
}

async function verifyGatewaySubjectJwt(
  headers: Headers,
  plaintextKey: string,
  expectedClientId: string,
  requiredScope: string,
  keyScopes: string[],
): Promise<VerifiedGatewaySubject> {
  const token = bearerSubjectToken(headers);
  const issuer = requiredSubjectEnvironment("GATEWAY_SUBJECT_JWT_ISSUER");
  const audience = requiredSubjectEnvironment("GATEWAY_SUBJECT_JWT_AUDIENCE");
  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(
      token,
      new TextEncoder().encode(plaintextKey),
      {
        algorithms: ["HS256"],
        issuer,
        audience,
        requiredClaims: ["sub", "iat", "exp", "jti", "scope"],
        clockTolerance: subjectTokenClockToleranceSeconds,
        maxTokenAge: `${maximumSubjectTokenLifetimeSeconds}s`,
      },
    ));
  } catch {
    throw authenticationError();
  }
  if (
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number" ||
    !Number.isInteger(payload.iat) ||
    !Number.isInteger(payload.exp) ||
    payload.exp <= payload.iat ||
    payload.exp - payload.iat > maximumSubjectTokenLifetimeSeconds
  ) {
    throw authenticationError();
  }
  const canonicalUserId = canonicalSubject(payload.sub);
  const clientIdClaim = stringClaim(payload.client_id, 160);
  const authorizedParty = stringClaim(payload.azp, 160);
  if (
    (clientIdClaim && authorizedParty && clientIdClaim !== authorizedParty) ||
    (clientIdClaim ?? authorizedParty) !== expectedClientId
  ) {
    throw authenticationError();
  }
  const tokenId = stringClaim(payload.jti, 200);
  if (!tokenId) throw authenticationError();
  const scopes = tokenScopes(payload);
  if (
    !scopes.includes(requiredScope) ||
    scopes.some((scope) => !keyScopes.includes(scope))
  ) {
    throw new GatewayError(
      "GATEWAY_SCOPE_REQUIRED",
      `The subject token does not grant ${requiredScope}`,
      403,
      "permission_error",
    );
  }
  return {
    canonicalUserId,
    clientId: expectedClientId,
    tokenId,
    scopes,
  };
}

async function findCanonicalIdentity(
  client: PoolClient,
  canonicalUserId: string,
) {
  const result = await client.query<GatewayIdentityRow>(
    `SELECT canonical_user.id::text AS canonical_user_id,
            u.id AS platform_user_id, u.source, u.external_user_id, u.tier,
            u.daily_token_limit, u.monthly_token_limit
       FROM users AS canonical_user
       JOIN platform_users AS u
         ON u.source = 'ink-dream'
        AND u.external_user_id = canonical_user.id::text
      WHERE canonical_user.id = $1::bigint
        AND u.status = 'active'
      LIMIT 1`,
    [canonicalUserId],
  );
  return result.rows[0] ?? null;
}

function principalFromIdentity(
  apiKeyId: string,
  scopes: string[],
  identity: GatewayIdentityRow,
): GatewayPrincipal {
  return {
    apiKeyId,
    platformUserId: identity.platform_user_id,
    source: identity.source,
    externalUserId: identity.external_user_id,
    tier: identity.tier,
    scopes,
    dailyTokenLimit: optionalSafeNumber(
      identity.daily_token_limit,
      "daily token limit",
    ),
    monthlyTokenLimit: optionalSafeNumber(
      identity.monthly_token_limit,
      "monthly token limit",
    ),
  };
}

export async function authenticateGatewayRequest(
  headers: Headers,
  requiredScope: string,
): Promise<GatewayPrincipal> {
  assertNoSubjectHeaderOverride(headers);
  const plaintext = extractGatewayApiKey(headers);
  if (!plaintext) {
    throw new GatewayError(
      "GATEWAY_API_KEY_REQUIRED",
      "A valid Gateway API key is required",
      401,
      "authentication_error",
    );
  }
  let keyHash: string;
  try {
    keyHash = hashGatewayApiKey(plaintext);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new GatewayError(
        "GATEWAY_API_KEY_INVALID",
        "The Gateway API key is invalid",
        401,
        "authentication_error",
      );
    }
    throw configurationError();
  }

  return await withPlatformClient(async (client) => {
    const { rows } = await client.query<GatewayKeyRow>(
      `SELECT k.id AS api_key_id, k.platform_user_id,
              COALESCE(k.subject_mode, 'fixed_user') AS subject_mode,
              k.service_client_id, k.scopes,
              canonical_user.id::text AS canonical_user_id,
              u.source, u.external_user_id, u.tier,
              u.daily_token_limit, u.monthly_token_limit
         FROM gateway_api_keys AS k
         LEFT JOIN platform_users AS u
           ON u.id = k.platform_user_id
          AND u.status = 'active'
         LEFT JOIN users AS canonical_user
           ON u.source = 'ink-dream'
          AND u.external_user_id = canonical_user.id::text
        WHERE k.key_hash = $1
          AND k.status = 'active'
          AND k.revoked_at IS NULL
          AND (k.expires_at IS NULL OR k.expires_at > NOW())
        LIMIT 1`,
      [keyHash],
    );
    const row = rows[0];
    if (!row) {
      throw new GatewayError(
        "GATEWAY_API_KEY_INVALID",
        "The Gateway API key is invalid or inactive",
        401,
        "authentication_error",
      );
    }
    if (!row.scopes.includes(requiredScope)) {
      throw new GatewayError(
        "GATEWAY_SCOPE_REQUIRED",
        `The API key does not grant ${requiredScope}`,
        403,
        "permission_error",
      );
    }

    const subjectMode = row.subject_mode ?? "fixed_user";
    let identity: GatewayIdentityRow | null = null;
    let principalScopes = row.scopes;
    if (subjectMode === "fixed_user") {
      if (
        !row.platform_user_id ||
        row.service_client_id ||
        !row.canonical_user_id ||
        !row.source ||
        !row.external_user_id ||
        !row.tier
      ) {
        throw new GatewayError(
          "GATEWAY_API_KEY_INVALID",
          "The Gateway API key is invalid or has no active canonical user",
          401,
          "authentication_error",
        );
      }
      identity = {
        canonical_user_id: row.canonical_user_id,
        platform_user_id: row.platform_user_id,
        source: row.source,
        external_user_id: row.external_user_id,
        tier: row.tier,
        daily_token_limit: row.daily_token_limit,
        monthly_token_limit: row.monthly_token_limit,
      };
    } else if (subjectMode === "canonical_subject") {
      if (row.platform_user_id || !row.service_client_id) {
        throw configurationError();
      }
      const verified = await verifyGatewaySubjectJwt(
        headers,
        plaintext,
        row.service_client_id,
        requiredScope,
        row.scopes,
      );
      identity = await findCanonicalIdentity(client, verified.canonicalUserId);
      principalScopes = verified.scopes;
      if (!identity) {
        throw new GatewayError(
          "GATEWAY_CANONICAL_USER_REQUIRED",
          "The Gateway subject is not an active canonical user",
          403,
          "permission_error",
        );
      }
    } else {
      throw configurationError();
    }

    await client.query(
      `UPDATE gateway_api_keys SET last_used_at = NOW() WHERE id = $1`,
      [row.api_key_id],
    );
    return principalFromIdentity(row.api_key_id, principalScopes, identity);
  });
}
