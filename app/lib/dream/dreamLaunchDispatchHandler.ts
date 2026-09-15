// [Input] Configured service OAuth and one closed registered dispatch claim/finish envelope.
// [Output] Live-owner and exact-capability gated metadata/result/audit transaction.
// [Pos] Registered thin launch metadata ingress; Runtime remains outside both committed UOWs.
// [Sync] 2026-09-15: reject entity grants and actor/context/metadata/status replacement selectors.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { dreamLaunchDispatchOperationContracts } from "./dreamLaunchDispatchDto";
import type { DreamLaunchDispatchOperation } from "./dreamLaunchDispatchDto";
import { dreamLaunchDispatchSchemaRequirements, executeDreamLaunchDispatch } from "./dreamLaunchDispatchService";

export function isDreamLaunchDispatchOperation(name: string): name is DreamLaunchDispatchOperation {
  return Object.hasOwn(dreamLaunchDispatchOperationContracts, name);
}
export async function handleDreamLaunchDispatch(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDreamLaunchDispatchOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = name, contract = dreamLaunchDispatchOperationContracts[operation];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: contract.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const token = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    return withDataTransaction(dreamLaunchDispatchSchemaRequirements, async tx => {
      const principal = await principalForServiceToken(tx, token, service, "dream:write");
      return executeDreamLaunchDispatch(operation, envelope.input, { principal, threadScope: null, runScope: null }, service.id, envelope.request_id, tx);
    });
  });
}
