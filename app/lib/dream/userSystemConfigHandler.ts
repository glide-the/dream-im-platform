// [Input] Configured service, live OAuth token and closed user SystemConfig operation envelope.
// [Output] Exact raw read or same-UOW patch/receipt/audit through the mandatory fixed codec.
// [Pos] Thin account-config ingress; entity grants and caller identities cannot manage settings.
// [Sync] 2026-09-15: register OAuth-only user get/patch without Runtime or generic database selectors.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { ReceiptRepository } from "./receipts";
import { identitySchemaRequirement } from "./schemaRequirements";
import { userSystemConfigOperationContracts as contracts, type UserSystemConfigOperation } from "./userSystemConfigDto";
import { runUserSystemConfigOperation, userSystemConfigSchemaRequirements, type UserSystemConfigCodec } from "./userSystemConfigService";
import { encodeUserSystemConfig } from "./userSystemConfigCodec";
export function isUserSystemConfigOperation(name: string): name is UserSystemConfigOperation { return Object.hasOwn(contracts, name); }
export async function handleUserSystemConfig(request: Request, name: string, codec: UserSystemConfigCodec = encodeUserSystemConfig) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isUserSystemConfigOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = contracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...userSystemConfigSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      const actor = { principal, threadScope: null, runScope: null, editorSessionScope: null };
      const action = () => runUserSystemConfigOperation(name, envelope.input, actor, tx, codec);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, principal.subject)
        .execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
    });
  });
}
