// [Input] Configured Dream service, OAuth bearer and one Registry105 Deck/Voice envelope.
// [Output] Strict aggregate context from the existing capability-checked Admin read UOW.
// [Pos] Thin named ingress; access rules and typed persistence stay in Service/Repository.
// [Sync] 2026-09-15: dispatch one OAuth-only read without receipt, prompt mode or Runtime inputs.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { deckChatContextOperationContracts, type DeckChatContextOperation } from "./deckChatContextDto";
import { deckChatContextSchemaRequirements, runDeckChatContextOperation } from "./deckChatContextService";
import { identitySchemaRequirement } from "./schemaRequirements";

export function isDeckChatContextOperation(name: string): name is DeckChatContextOperation {
  return Object.hasOwn(deckChatContextOperationContracts, name);
}

export async function handleDeckChatContext(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDeckChatContextOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = deckChatContextOperationContracts[name];
    const envelope = await parseAuthDto(
      request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")),
    );
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...deckChatContextSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(
        tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "",
        service,
        operation.userScope,
      );
      return runDeckChatContextOperation(name, envelope.input, { principal, threadScope: null }, tx);
    });
  });
}
