// [Input] Verified service plus OAuth bearer or an Admin runtime delegation.
// [Output] Server-derived active principal constrained to its entity scope.
// [Pos] Shared data authorization boundary; no caller user_id overrides.
// [Sync] 2026-09-15: resolve OAuth and runtime delegation actors without caller user overrides.
import type { DreamServiceClient } from "../auth/config";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { DelegationService } from "../auth/delegationService";
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
export async function requireDataActor(tx: DataTransaction, headers: Headers, service: DreamServiceClient, requiredScope: string, threadId?: string, runId?: string | null) {
  const authorization = headers.get("authorization") ?? "", token = authorization.replace(/^Bearer /, "");
  if (token.startsWith("idg_")) {
    const delegated = await new DelegationService(tx).resolve(token, requiredScope, service.id, threadId, runId);
    return { principal: delegated.principal, threadScope: delegated.threadId, runScope: delegated.runId };
  }
  return { principal: await principalForServiceToken(tx, token, service, requiredScope), threadScope: null, runScope: null };
}
