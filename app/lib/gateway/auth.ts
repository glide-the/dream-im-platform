// [Input] Active Gateway key plus Admin OAuth grant, or Admin-issued entity-limited runtime bearer.
// [Output] Canonical billing principal preserving active key scope and account/model restrictions.
// [Pos] Gateway authentication; Dream cannot sign user tokens or share a service key with runtime.
// [Sync] 2026-09-14: retire HS256 subject authority and add opaque delegation authentication.
import type { PoolClient } from "pg";
import { withPlatformClient } from "../platform-db";
import { extractGatewayApiKey, hashGatewayApiKey } from "./api-keys";
import { GatewayError } from "./errors";
import { verifyAdminAccessToken } from "../auth/accessToken";
import { withAuthTransaction } from "../auth/database";
import { SubjectRepository } from "../auth/subjectRepository";
import { gatewayClientBindings } from "../auth/gatewayBindings";
import { AuthBoundaryError } from "../auth/config";
import { withDataTransaction } from "../dream/database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "../dream/schemaRequirements";
import { DelegationService } from "../auth/delegationService";


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

async function verifyGatewaySubjectJwt(headers: Headers, expectedClientId: string, requiredScope: string, keyScopes: string[]): Promise<VerifiedGatewaySubject> {
  try {
    const verified = await verifyAdminAccessToken(headers, requiredScope);
    const permitted = gatewayClientBindings().some(binding => binding.gateway_client_id === expectedClientId && binding.oauth_client_ids.includes(verified.clientId));
    if (!permitted) throw authenticationError();
    const identity = await withAuthTransaction(tx => new SubjectRepository(tx).findActive(verified.subject));
    if (!identity) throw new GatewayError("GATEWAY_CANONICAL_USER_REQUIRED", "An active canonical user is required", 403, "permission_error");
    const scopes = verified.scopes.filter(scope => keyScopes.includes(scope));
    if (!scopes.includes(requiredScope)) throw new GatewayError("GATEWAY_SCOPE_REQUIRED", "The Gateway key does not grant this scope", 403, "permission_error");
    return { canonicalUserId: identity.canonicalUserId.toString(), clientId: expectedClientId, tokenId: verified.tokenId, scopes };
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (error instanceof AuthBoundaryError && error.status < 500) throw new GatewayError(error.status === 403 ? "GATEWAY_SCOPE_REQUIRED" : "GATEWAY_SUBJECT_TOKEN_INVALID", "Gateway authentication could not be completed", error.status, error.status === 403 ? "permission_error" : "authentication_error");
    throw configurationError();
  }
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
        AND canonical_user.status = 'active'
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
  const opaque = headers.get("authorization")?.match(/^Bearer (idg_[A-Za-z0-9_-]{43})$/)?.[1] ?? headers.get("x-api-key")?.match(/^(idg_[A-Za-z0-9_-]{43})$/)?.[1];
  if (opaque) return authenticateRuntimeGateway(opaque, requiredScope);
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
          AND canonical_user.status = 'active'
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

async function authenticateRuntimeGateway(token: string, requiredScope: string): Promise<GatewayPrincipal> {
  try {
    const actor = await withDataTransaction([identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement], tx => new DelegationService(tx).resolve(token, requiredScope));
    if (!actor.gatewayApiKeyId) throw authenticationError();
    return withPlatformClient(async client => {
      const key = await client.query<{ id: string; scopes: string[] }>(`SELECT id, scopes FROM gateway_api_keys WHERE id = $1 AND subject_mode = 'canonical_subject' AND status = 'active' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())`, [actor.gatewayApiKeyId]);
      if (!key.rows[0] || !key.rows[0].scopes.includes(requiredScope)) throw authenticationError();
      const identity = await findCanonicalIdentity(client, actor.principal.canonical_user_id);
      if (!identity) throw new GatewayError("GATEWAY_CANONICAL_USER_REQUIRED", "An active canonical user is required", 403, "permission_error");
      await client.query("UPDATE gateway_api_keys SET last_used_at = NOW() WHERE id = $1", [key.rows[0].id]);
      return principalFromIdentity(key.rows[0].id, actor.principal.scopes.filter(scope => key.rows[0].scopes.includes(scope)), identity);
    });
  } catch (error) {
    if (error instanceof GatewayError) throw error;
    if (error instanceof AuthBoundaryError && error.status < 500) throw new GatewayError("GATEWAY_DELEGATION_REQUIRED", "An active entity delegation is required", error.status, "authentication_error");
    throw configurationError();
  }
}
