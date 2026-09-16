// [Input] Registered Registry170-174 name, service-bound OAuth request and strict operation envelope.
// [Output] DTO-validated Deck Plugin control result; apply commits domain state, receipt and audit in one transaction.
// [Pos] Thin OAuth ingress; no filesystem, Runtime execution or generic database dispatch.
// [Sync] 2026-09-16: expose Admin-owned Deck Plugin control operations.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { identitySchemaRequirement } from "./schemaRequirements";
import { withDataTransaction } from "./database";
import { deckPluginControlOperationContracts, type DeckPluginControlOperation } from "./deckPluginControlDto";
import { deckPluginControlSchemaRequirements, runDeckPluginControlOperation } from "./deckPluginControlService";
import { ReceiptRepository } from "./receipts";

export function isDeckPluginControlOperation(name: string): name is DeckPluginControlOperation {
  return Object.hasOwn(deckPluginControlOperationContracts, name);
}

export async function handleDeckPluginControl(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDeckPluginControlOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = deckPluginControlOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...deckPluginControlSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      const action = () => runDeckPluginControlOperation(name, envelope.input, principal, tx);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, principal.subject)
        .execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
    });
  });
}
