// [Input] Configured service request, named registered operation and strict request envelope.
// [Output] OAuth owner or task-bound background dispatch inside one capability-gated Admin UOW.
// [Pos] Registry99 Reflections ingress; Route delegates while the service owns business rules.
// [Sync] 2026-09-15: register credential-separated OAuth/background dispatch after strict parsing.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { identitySchemaRequirement } from "./schemaRequirements";
import { withDataTransaction } from "./database";
import { reflectionTaskOperationContracts, type ReflectionTaskBackgroundOperation, type ReflectionTaskOperation, type ReflectionTaskUserOperation } from "./reflectionTaskDto";
import { reflectionTaskSchemaRequirements, runReflectionTaskBackgroundOperation, runReflectionTaskUserOperation } from "./reflectionTaskService";

export function isReflectionTaskOperation(name: string): name is ReflectionTaskOperation { return Object.hasOwn(reflectionTaskOperationContracts, name); }
export async function handleReflectionTaskOperation(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isReflectionTaskOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const contract = reflectionTaskOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: contract.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...reflectionTaskSchemaRequirements], async tx => {
      if (contract.audience === "background") {
        if (request.headers.has("authorization")) throw new AuthBoundaryError("REFLECTION_BROWSER_CREDENTIAL_FORBIDDEN", 400);
        return runReflectionTaskBackgroundOperation(name as ReflectionTaskBackgroundOperation, envelope.input, service, tx, envelope.request_id);
      }
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, contract.userScope);
      return runReflectionTaskUserOperation(name as ReflectionTaskUserOperation, envelope.input, { principal, threadScope: null, editorSessionScope: null, runScope: null }, tx, service.id, envelope.request_id);
    });
  });
}
