// [Input] Configured Dream service, OAuth or exact Thread persistence bearer and one Registry105 Deck/Voice envelope.
// [Output] Strict aggregate context from the existing capability-checked Admin read UOW.
// [Pos] Thin named ingress; access rules and typed persistence stay in Service/Repository.
// [Sync] 2026-09-15: dispatch one OAuth-only read without receipt, prompt mode or Runtime inputs.
// [Sync] 2026-09-28: allow claim-bound source Thread reads after verifying null Run/editor scope and server-persistence purpose.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { DelegationService } from "../auth/delegationService";
import { withDataTransaction } from "./database";
import { deckChatContextOperationContracts, type DeckChatContextOperation } from "./deckChatContextDto";
import { deckChatContextSchemaRequirements, runDeckChatContextOperation } from "./deckChatContextService";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";

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
    const bearer = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const delegated = bearer.startsWith("idg_");
    return withDataTransaction([identitySchemaRequirement, ...deckChatContextSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      if (delegated) {
        const authority = await new DelegationService(tx).resolve(
          bearer, operation.userScope, service.id, undefined, null, null,
        );
        if (authority.purpose !== "server-persistence") throw new AuthBoundaryError("DELEGATION_PURPOSE_DENIED", 403);
        return runDeckChatContextOperation(name, envelope.input,
          { principal: authority.principal, threadScope: authority.threadId }, tx);
      }
      const principal = await principalForServiceToken(tx, bearer, service, operation.userScope);
      return runDeckChatContextOperation(name, envelope.input, { principal, threadScope: null }, tx);
    });
  });
}
