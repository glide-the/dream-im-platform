import { withPlatformClient } from "../platform-db";
import { extractGatewayApiKey, hashGatewayApiKey } from "./api-keys";
import { GatewayError } from "./errors";

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

type GatewayKeyRow = {
  api_key_id: string;
  platform_user_id: string;
  source: string;
  external_user_id: string;
  tier: string;
  scopes: string[];
  daily_token_limit: string | number | null;
  monthly_token_limit: string | number | null;
};

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

export async function authenticateGatewayRequest(
  headers: Headers,
  requiredScope: string,
): Promise<GatewayPrincipal> {
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
    throw new GatewayError(
      "GATEWAY_AUTH_NOT_CONFIGURED",
      "Gateway authentication is not configured",
      503,
      "configuration_error",
    );
  }

  return await withPlatformClient(async (client) => {
    const { rows } = await client.query<GatewayKeyRow>(
      `SELECT k.id AS api_key_id, k.platform_user_id, k.scopes,
              u.source, u.external_user_id, u.tier,
              u.daily_token_limit, u.monthly_token_limit
       FROM gateway_api_keys AS k
       JOIN platform_users AS u ON u.id = k.platform_user_id
       WHERE k.key_hash = $1
         AND k.status = 'active'
         AND k.revoked_at IS NULL
         AND (k.expires_at IS NULL OR k.expires_at > NOW())
         AND u.status = 'active'
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
    await client.query(
      `UPDATE gateway_api_keys SET last_used_at = NOW() WHERE id = $1`,
      [row.api_key_id],
    );
    return {
      apiKeyId: row.api_key_id,
      platformUserId: row.platform_user_id,
      source: row.source,
      externalUserId: row.external_user_id,
      tier: row.tier,
      scopes: row.scopes,
      dailyTokenLimit: optionalSafeNumber(
        row.daily_token_limit,
        "daily token limit",
      ),
      monthlyTokenLimit: optionalSafeNumber(
        row.monthly_token_limit,
        "monthly token limit",
      ),
    };
  });
}
