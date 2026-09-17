// [Input] Verified service plus OAuth bearer or an operation-bound Admin opaque authority.
// [Output] Server-derived active principal constrained to the exact operation and entity scope.
// [Pos] Shared data authorization boundary; no caller user_id overrides.
// [Sync] 2026-09-15: resolve Reflections worker authority only when the caller supplies an exact allowlisted operation.
import type { DreamServiceClient } from "../auth/config";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { DelegationService } from "../auth/delegationService";
import { AuthBoundaryError } from "../auth/config";
import type { DataTransaction } from "./database";
import { resolveReflectionTaskAuthority } from "./reflectionTaskAuthorityService";
export async function requireDataActor(tx: DataTransaction, headers: Headers, service: DreamServiceClient, requiredScope: string, threadId?: string, runId?: string | null, operationName?: string) {
  const authorization = headers.get("authorization") ?? "", token = authorization.replace(/^Bearer /, "");
  if (token.startsWith("idg_")) {
    const delegated = await new DelegationService(tx).resolve(token, requiredScope, service.id, threadId, runId);
    return { principal: delegated.principal, threadScope: delegated.threadId, runScope: delegated.runId };
  }
  if (token.startsWith("rta_")) {
    if (!authorization.startsWith("Bearer rta_")) throw new AuthBoundaryError("REFLECTION_AUTHORITY_REQUIRED", 401);
    if (!operationName) throw new AuthBoundaryError("REFLECTION_AUTHORITY_OPERATION_DENIED", 403);
    const authority = await resolveReflectionTaskAuthority(tx, token, operationName, service.id);
    if (authority.principal.scopes.includes(requiredScope) === false || (threadId !== undefined && authority.threadScope !== threadId) || (runId != null && authority.runScope !== runId)) throw new AuthBoundaryError("REFLECTION_AUTHORITY_ENTITY_DENIED", 403);
    return { principal: authority.principal, threadScope: authority.threadScope, runScope: authority.runScope };
  }
  return { principal: await principalForServiceToken(tx, token, service, requiredScope), threadScope: null, runScope: null };
}
