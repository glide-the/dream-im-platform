// [Input] Configured service, closed Thread selector and OAuth, persistence or Reflections task bearer.
// [Output] Current owner-checked raw config through the mandatory fixed codec in one read UOW.
// [Pos] Thin Runtime snapshot read; no caller Run/config selector, write, receipt or Runtime execution.
// [Sync] 2026-09-15: resolve task authority only for the exact Thread config read and matching Thread.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { DelegationService } from "../auth/delegationService";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, reflectionTaskSchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { threadSystemConfigOperationContracts as contracts, type ThreadSystemConfigOperation } from "./threadSystemConfigDto";
import { runThreadSystemConfigOperation, threadSystemConfigSchemaRequirements, type ThreadSystemConfigActor } from "./threadSystemConfigService";
import { encodeUserSystemConfig } from "./userSystemConfigCodec";
import type { UserSystemConfigCodec } from "./userSystemConfigService";
import { authoritativeWorkflowContext } from "./workflowContextService";
import { resolveReflectionTaskAuthority } from "./reflectionTaskAuthorityService";
export function isThreadSystemConfigOperation(name: string): name is ThreadSystemConfigOperation { return Object.hasOwn(contracts, name); }
export async function handleThreadSystemConfig(request: Request, name: string, codec: UserSystemConfigCodec = encodeUserSystemConfig) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isThreadSystemConfigOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = contracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const authorization = request.headers.get("authorization") ?? "", bearer = authorization.replace(/^Bearer /, ""), delegated = bearer.startsWith("idg_"), reflectionAuthority = authorization.startsWith("Bearer rta_");
    return withDataTransaction([identitySchemaRequirement, ...threadSystemConfigSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []),
      ...(reflectionAuthority ? [reflectionTaskSchemaRequirement] : [])], async tx => {
      let actor: ThreadSystemConfigActor;
      if (reflectionAuthority) {
        const resolved = await resolveReflectionTaskAuthority(tx, bearer, name, service.id);
        if (resolved.threadScope !== envelope.input.thread_id) throw new AuthBoundaryError("REFLECTION_AUTHORITY_ENTITY_DENIED", 403);
        actor = { principal: resolved.principal, threadScope: resolved.threadScope, runScope: null, editorSessionScope: null };
      } else if (delegated) {
        const resolved = await new DelegationService(tx).resolve(bearer, operation.userScope, service.id, envelope.input.thread_id);
        if (resolved.purpose !== "server-persistence" || resolved.editorSessionId !== null) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
        if (resolved.runId !== null) {
          const current = await authoritativeWorkflowContext(tx, resolved.principal.canonical_user_id, envelope.input.thread_id);
          if (!current || current.workflow_run_id !== resolved.runId) throw new AuthBoundaryError("DELEGATION_ENTITY_DENIED", 403);
        }
        actor = { principal: resolved.principal, threadScope: resolved.threadId, runScope: resolved.runId, editorSessionScope: resolved.editorSessionId };
      } else {
        actor = { principal: await principalForServiceToken(tx, bearer, service, operation.userScope), threadScope: null, runScope: null, editorSessionScope: null };
      }
      return runThreadSystemConfigOperation(name, envelope.input, actor, tx, codec);
    });
  });
}
