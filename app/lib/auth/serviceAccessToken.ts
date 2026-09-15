// [Input] Verified service identity and Admin OAuth access token for the requested user scope.
// [Output] Active explicit principal only for that service's browser or configured device client.
// [Pos] Shared user/service grant binding; product/Gateway retain their own configured client policies.
// [Sync] 2026-09-15: reject entity bearers at OAuth-only service boundaries.
import { AuthBoundaryError, requiredAuthValue, type DreamServiceClient } from "./config";
import { principalForAccessToken } from "./browserSessionService";
export async function principalForServiceToken(database: Parameters<typeof principalForAccessToken>[0], token: string, service: DreamServiceClient, scope?: string) {
  if (token.startsWith("idg_")) throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
  const principal = await principalForAccessToken(database, token, scope);
  if (principal.client_id !== service.oauthClientId && principal.client_id !== requiredAuthValue("AUTH_DEVICE_CLIENT_ID")) throw new AuthBoundaryError("ACCESS_CLIENT_DENIED", 403);
  return principal;
}
