// [Sync] 2026-10-10: bind image operation/model ownership and preserve real call identity through original authorization, files and history.
// [Input] Original authenticated service and opaque server-persistence grant plus a strict named image envelope.
// [Output] Capability-gated immutable binding/selection DTO; OAuth/browser identity cannot choose the owner.
// [Pos] Existing Dream domain HTTP ingress, not a Runner control channel.
// [Sync] 2026-10-10: expose image-only original operation contracts under the exact new schema capability.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { DelegationService } from "../auth/delegationService";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { imageTurnOperationContracts, type ImageTurnOperation } from "./imageTurnDto";
import { executeImageTurnOperation, imageTurnSchemaRequirements } from "./imageTurnService";
export function isImageTurnOperation(name: string): name is ImageTurnOperation { return Object.hasOwn(imageTurnOperationContracts, name); }
export async function handleImageTurnOperation(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isImageTurnOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const contract = imageTurnOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: contract.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const authorization = request.headers.get("authorization") ?? "";
    if (!authorization.startsWith("Bearer idg_")) throw new AuthBoundaryError("IMAGE_TURN_AUTHORITY_REQUIRED", 403);
    return withDataTransaction(imageTurnSchemaRequirements, async tx => {
      const authority = await new DelegationService(tx).resolve(authorization.slice(7), "dream:write", service.id, envelope.input.thread_id);
      return executeImageTurnOperation(tx, authority, name, envelope.request_id, envelope.input);
    });
  });
}
