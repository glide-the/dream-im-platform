// [Input] Internal service envelope and scope-only Reflections operation descriptor.
// [Output] Owner OAuth creation/summary and service-owned page authorization/evidence dispatch.
// [Pos] Existing Admin auth/transaction ingress for Reflections v2; no new public route.
// [Sync] 2026-10-23: preserve explicit audience, task ownership and published schema gates.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { hasDelegatedUserBearer } from "../auth/serviceIdentity";
import { identitySchemaRequirement, reflectionTaskSchemaRequirements, reflectionAnalysisSchemaRequirement } from "./schemaRequirements";
import { withDataTransaction } from "./database";
import { reflectionNotionScopeOperations, type ReflectionNotionScopeOperation } from "./reflectionNotionScopeDto";
import { runReflectionScopeBackgroundOperation, runReflectionScopeUserOperation } from "./reflectionNotionScopeService";
export function isReflectionNotionScopeOperation(name: string): name is ReflectionNotionScopeOperation { return Object.hasOwn(reflectionNotionScopeOperations, name); }
export function handleReflectionNotionScopeOperation(request: Request, name: ReflectionNotionScopeOperation) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const contract = reflectionNotionScopeOperations[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: contract.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...reflectionTaskSchemaRequirements, reflectionAnalysisSchemaRequirement], async tx => {
      if (contract.audience === "background") {
        if (hasDelegatedUserBearer(request)) throw new AuthBoundaryError("REFLECTION_BROWSER_CREDENTIAL_FORBIDDEN", 400);
        return runReflectionScopeBackgroundOperation(name, envelope.input, service, tx);
      }
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, contract.userScope);
      return runReflectionScopeUserOperation(name, envelope.input, { principal, threadScope: null }, tx, service.id, envelope.request_id);
    });
  });
}
