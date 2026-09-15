// [Input] Configured service, closed Thread selector and OAuth or persistence bearer.
// [Output] Current owner-checked raw config through the mandatory fixed codec in one read UOW.
// [Pos] Thin Runtime snapshot read; no caller Run/config selector, write, receipt or Runtime execution.
// [Sync] 2026-09-15: resolve OAuth or exact Thread persistence authority for config read.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { DelegationService } from "../auth/delegationService";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { threadSystemConfigOperationContracts as contracts, type ThreadSystemConfigOperation } from "./threadSystemConfigDto";
import { runThreadSystemConfigOperation, threadSystemConfigSchemaRequirements, type ThreadSystemConfigActor } from "./threadSystemConfigService";
import { encodeUserSystemConfig } from "./userSystemConfigCodec";
import type { UserSystemConfigCodec } from "./userSystemConfigService";
import { authoritativeWorkflowContext } from "./workflowContextService";
export function isThreadSystemConfigOperation(name: string): name is ThreadSystemConfigOperation { return Object.hasOwn(contracts, name); }
export async function handleThreadSystemConfig(request: Request, name: string, codec: UserSystemConfigCodec = encodeUserSystemConfig) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isThreadSystemConfigOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = contracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const authorization = request.headers.get("authorization") ?? "", bearer = authorization.replace(/^Bearer /, ""), delegated = bearer.startsWith("idg_");
    return withDataTransaction([identitySchemaRequirement, ...threadSystemConfigSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      let actor: ThreadSystemConfigActor;
      if (delegated) {
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
