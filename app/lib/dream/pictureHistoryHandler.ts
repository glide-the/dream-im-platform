// [Input] Configured Dream service, OAuth bearer and one Registry103 picture-history envelope.
// [Output] Strict read result from the current actor's Admin data transaction.
// [Pos] Thin picture-history ingress; business validation and persistence remain in Service/Repository.
// [Sync] 2026-09-15: dispatch two OAuth-only reads without receipt or friendship authorization.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { pictureHistoryOperationContracts, type PictureHistoryOperation } from "./pictureHistoryDto";
import { runPictureHistoryOperation, pictureHistorySchemaRequirements } from "./pictureHistoryService";
import { identitySchemaRequirement } from "./schemaRequirements";

export function isPictureHistoryOperation(name: string): name is PictureHistoryOperation {
  return Object.hasOwn(pictureHistoryOperationContracts, name);
}

export async function handlePictureHistory(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isPictureHistoryOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = pictureHistoryOperationContracts[name];
    const envelope = await parseAuthDto(
      request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")),
    );
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...pictureHistorySchemaRequirements], async tx => {
      const principal = await principalForServiceToken(
        tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
        service,
        operation.userScope,
      );
      return runPictureHistoryOperation(name, envelope.input, { principal, threadScope: null }, tx);
    });
  });
}
