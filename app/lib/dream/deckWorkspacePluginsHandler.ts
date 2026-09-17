// [Input] Configured Dream service, OAuth or exact Thread grant and one Registry106 envelope.
// [Output] Strict workspace plugin metadata from one capability-checked read UOW.
// [Pos] Thin Registry106 ingress; artifact bytes and filesystem execution remain in Dream.
// [Sync] 2026-09-15: bind the actor to the requested Thread before invoking the typed service.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { deckWorkspacePluginsOperationContracts, type DeckWorkspacePluginsOperation } from "./deckWorkspacePluginsDto";
import { deckWorkspacePluginsSchemaRequirements, runDeckWorkspacePluginsOperation } from "./deckWorkspacePluginsService";

export function isDeckWorkspacePluginsOperation(name: string): name is DeckWorkspacePluginsOperation {
  return Object.hasOwn(deckWorkspacePluginsOperationContracts, name);
}

export async function handleDeckWorkspacePlugins(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isDeckWorkspacePluginsOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = deckWorkspacePluginsOperationContracts[name];
    const envelope = await parseAuthDto(
      request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")),
    );
    setRequestId(envelope.request_id);
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    return withDataTransaction([
      identitySchemaRequirement,
      ...deckWorkspacePluginsSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : []),
    ], async tx => {
      const actor = await requireDataActor(
        tx,
        request.headers,
        service,
        operation.userScope,
        envelope.input.thread_id,
      );
      return runDeckWorkspacePluginsOperation(name, envelope.input, actor, tx);
    });
  });
}
