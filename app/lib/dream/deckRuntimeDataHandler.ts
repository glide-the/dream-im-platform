// [Input] Named refs/analysis/memory operation, configured service and bound OAuth or exact Thread grant.
// [Output] Coordinator-owned strict domain result; writes/receipt/audit share the Admin data UOW.
// [Pos] Thin runtime-metadata ingress; artifact/CLI/FS execution stays with Dream.
// [Sync] 2026-09-15: keep refs management OAuth-only and scope memory recovery to the original Thread.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { ReceiptRepository } from "./receipts";
import { deckRuntimeDataOperationContracts, threadDataInputDto, type DeckRuntimeDataOperation } from "./deckRuntimeDataDto";
import { deckRuntimeDataSchemaRequirements, runDeckRuntimeDataOperation } from "./deckRuntimeDataService";
export function isDeckRuntimeDataOperation(name: string): name is DeckRuntimeDataOperation { return Object.hasOwn(deckRuntimeDataOperationContracts, name); }
export function isThreadRuntimeDataOperation(name: string) { return name === "deck-plugin-refs.runtime-read" || name === "voice-memory.resolve"; }
export async function handleDeckRuntimeData(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDeckRuntimeDataOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = deckRuntimeDataOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }), Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const threadId = isThreadRuntimeDataOperation(name) ? threadDataInputDto.parse(envelope.input).thread_id : null;
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    return withDataTransaction([identitySchemaRequirement, ...deckRuntimeDataSchemaRequirements, ...(delegated && threadId ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      const actor = threadId ? await requireDataActor(tx, request.headers, service, operation.userScope, threadId)
        : { principal: await principalForServiceToken(tx, request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope), threadScope: null };
      const action = () => runDeckRuntimeDataOperation(name, envelope.input, actor, tx);
      return operation.kind === "read" ? action() : new ReceiptRepository(tx, service.id, actor.principal.subject).execute(name, envelope.request_id, envelope.input, operation.output as z.ZodType, action, threadId);
    });
  });
}
