// [Input] Configured Dream service, OAuth bearer and one Registry101 request envelope.
// [Output] A strict domain result committed with its original receipt and audit in the same UOW.
// [Pos] Thin local-data ingress; business validation and persistence remain in Service/Repository.
// [Sync] 2026-09-15: register two OAuth-only writes with the shared body limit and receipt boundary.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { localDataImportOperationContracts, type LocalDataImportOperation } from "./localDataImportDto";
import { runLocalDataImportOperation, localDataImportSchemaRequirements } from "./localDataImportService";
import { ReceiptRepository } from "./receipts";
import { identitySchemaRequirement } from "./schemaRequirements";

export function isLocalDataImportOperation(name: string): name is LocalDataImportOperation {
  return Object.hasOwn(localDataImportOperationContracts, name);
}
export async function handleLocalDataImport(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isLocalDataImportOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = localDataImportOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...localDataImportSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      const actor = { principal, threadScope: null, editorSessionScope: null, runScope: null };
      return new ReceiptRepository(tx, service.id, principal.subject).execute(
        name, envelope.request_id, envelope.input, operation.output as z.ZodType,
        () => runLocalDataImportOperation(name, envelope.input, actor, tx),
      );
    });
  });
}
