// [Input] Registered Deck/Voice business operation, service-bound OAuth and strict request envelope.
// [Output] Validated aggregate DTO; writes/result/audit commit in one existing Admin transaction.
// [Pos] Thin named domain orchestration, with no runtime-grant Deck management authority.
// [Sync] 2026-09-14: register the coordinator-owned production services for isolated Route validation.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { identitySchemaRequirement } from "./schemaRequirements";
import { withDataTransaction } from "./database";
import { deckVoiceOperationContracts, type DeckVoiceOperation } from "./deckVoiceDto";
import { deckVoiceSchemaRequirements, runDeckVoiceOperation } from "./deckVoiceService";
import { ReceiptRepository } from "./receipts";
export function isDeckVoiceOperation(name: string): name is DeckVoiceOperation { return Object.hasOwn(deckVoiceOperationContracts, name); }
export async function handleDeckVoiceOperation(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDeckVoiceOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = deckVoiceOperationContracts[name];
    const input = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(input.request_id);
    return withDataTransaction([identitySchemaRequirement, ...deckVoiceSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.kind === "read" ? "dream:read" : "dream:write");
      const action = () => runDeckVoiceOperation(name, input.input, { principal, threadScope: null }, tx);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, principal.subject).execute(name, input.request_id, input.input, operation.output as z.ZodType, action);
    });
  });
}
