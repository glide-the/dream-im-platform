// [Input] Separate service identity and target OAuth user access token.
// [Output] Minimal active subject/canonical DTO without ORM row leakage.
// [Pos] Dream principal ingress orchestration; authorization data stays in repositories.
// [Sync] 2026-09-14: replace user_id guessing with verified subject linkage.
import { AuthBoundaryError } from "./config";
import { principalForServiceToken } from "./serviceAccessToken";
import { handleInternalAuthRequest } from "./internalHandler";
import { withAuthTransaction } from "./database";
export async function handlePrincipal(request: Request) {
  return handleInternalAuthRequest(request, async service => {
    const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9._~-]+)$/)?.[1];
    if (!token) throw new AuthBoundaryError("ACCESS_TOKEN_REQUIRED", 401);
    return withAuthTransaction(tx => principalForServiceToken(tx, token, service));
  });
}
