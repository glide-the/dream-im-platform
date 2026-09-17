// [Input] Configured service and closed Reflections custom-prompt operation with live OAuth access token.
// [Output] Exact identity/unified-gated owner UOW; strict body/permission and atomic write receipt/audit.
// [Pos] Registered thin ingress; shared Route dispatches only the three closed operation names.
// [Sync] 2026-09-15: publish OAuth-only ownership without generic settings or Runtime grants.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { reflectionsSectionConfigOperationContracts as contracts, type ReflectionsSectionConfigOperation } from "./reflectionsSectionConfigDto";
import { reflectionsSectionConfigSchemaRequirements, runReflectionsSectionConfigOperation } from "./reflectionsSectionConfigService";
export function isReflectionsSectionConfigOperation(name: string): name is ReflectionsSectionConfigOperation { return Object.hasOwn(contracts, name); }
export async function handleReflectionsSectionConfig(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isReflectionsSectionConfigOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const contract = contracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: contract.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction(reflectionsSectionConfigSchemaRequirements, async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, contract.userScope);
      return runReflectionsSectionConfigOperation(name, envelope.input, { principal, threadScope: null }, tx, service.id, envelope.request_id);
    });
  });
}
