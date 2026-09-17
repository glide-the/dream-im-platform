// [Input] Registered Registry122-132 operation, service-bound OAuth and strict request envelope.
// [Output] DTO-validated binding/Runtime result; every write commits with its receipt in one Admin transaction.
// [Pos] Thin OAuth-only ingress; no Runtime, filesystem or generic database dispatch.
// [Sync] 2026-09-16: expose launch scope/current/replay and evidence-bound Runtime preparation.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { identitySchemaRequirement } from "./schemaRequirements";
import { withDataTransaction } from "./database";
import { deckPluginBindingOperationContracts, type DeckPluginBindingOperation } from "./deckPluginBindingDto";
import { deckPluginBindingSchemaRequirements, runDeckPluginBindingOperation } from "./deckPluginBindingService";
import { ReceiptRepository } from "./receipts";

export function isDeckPluginBindingOperation(name: string): name is DeckPluginBindingOperation {
  return Object.hasOwn(deckPluginBindingOperationContracts, name);
}

export async function handleDeckPluginBinding(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDeckPluginBindingOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = deckPluginBindingOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...deckPluginBindingSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      const action = () => runDeckPluginBindingOperation(name, envelope.input, principal, tx);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, principal.subject).execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action);
    });
  });
}
