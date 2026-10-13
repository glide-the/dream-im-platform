// [Input] Existing internal auth handler, explicit additive content capability and request envelope.
// [Output] Owner-scoped create/summary and service-only task-bound input dispatch.
// [Pos] Additive Reflections input ingress; no business logic in Route Handlers.
// [Sync] 2026-10-13: fail closed unless the forward content capability is published.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { hasDelegatedUserBearer } from "../auth/serviceIdentity";
import { identitySchemaRequirement, reflectionTaskSchemaRequirements } from "./schemaRequirements";
import { withDataTransaction } from "./database";
import { reflectionAnalysisContentOperations, type ReflectionAnalysisOperation } from "./reflectionAnalysisContentDto";
import { reflectionAnalysisSchemaRequirement, runReflectionAnalysisBackgroundOperation, runReflectionAnalysisUserOperation } from "./reflectionAnalysisContentService";

export function isReflectionAnalysisOperation(name: string): name is ReflectionAnalysisOperation { return Object.hasOwn(reflectionAnalysisContentOperations, name); }
export async function handleReflectionAnalysisOperation(request: Request, name: ReflectionAnalysisOperation) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    const contract = reflectionAnalysisContentOperations[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: contract.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...reflectionTaskSchemaRequirements, reflectionAnalysisSchemaRequirement], async tx => {
      if (contract.audience === "background") {
        if (hasDelegatedUserBearer(request)) throw new AuthBoundaryError("REFLECTION_BROWSER_CREDENTIAL_FORBIDDEN", 400);
        return runReflectionAnalysisBackgroundOperation(envelope.input, service, tx);
      }
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, contract.userScope);
      return runReflectionAnalysisUserOperation(name as Exclude<ReflectionAnalysisOperation, "reflection-task.analysis-content-load">, envelope.input, { principal, threadScope: null }, tx, service.id, envelope.request_id);
    });
  });
}
