// [Input] Configured service, bound OAuth and a closed current-owner preference envelope.
// [Output] Coordinator-owned strict projection or same-UOW merge/receipt/audit result.
// [Pos] Thin preference ingress; entity persistence grants cannot manage account preferences.
// [Sync] 2026-09-15: register the verified two operations with explicit OAuth-only authorization.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement } from "./schemaRequirements";
import { ReceiptRepository } from "./receipts";
import { userPreferencesOperationContracts, type UserPreferencesOperation } from "./userPreferencesDto";
import { runUserPreferencesOperation, userPreferencesSchemaRequirements } from "./userPreferencesService";
export function isUserPreferencesOperation(name: string): name is UserPreferencesOperation { return Object.hasOwn(userPreferencesOperationContracts, name); }
export async function handleUserPreferences(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isUserPreferencesOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = userPreferencesOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...userPreferencesSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      const action = () => runUserPreferencesOperation(name, envelope.input, { principal, threadScope: null }, tx);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, principal.subject).execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
    });
  });
}
