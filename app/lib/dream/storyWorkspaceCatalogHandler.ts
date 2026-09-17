// [Input] Configured Dream service, OAuth bearer, and one Registry114 catalog envelope.
// [Output] Capability-gated catalog result from a single Admin transaction.
// [Pos] Thin OAuth-only catalog ingress; all filtering and mutation behavior is server-owned.
// [Sync] 2026-09-15: expose strict Story Workspace catalog operations without generic CRUD.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceCatalogOperationContracts, type StoryWorkspaceCatalogOperation } from "./storyWorkspaceCatalogDto";
import { runStoryWorkspaceCatalogOperation, storyWorkspaceCatalogSchemaRequirements } from "./storyWorkspaceCatalogService";

export function isStoryWorkspaceCatalogOperation(name: string): name is StoryWorkspaceCatalogOperation {
  return Object.hasOwn(storyWorkspaceCatalogOperationContracts, name);
}

export async function handleStoryWorkspaceCatalog(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isStoryWorkspaceCatalogOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = storyWorkspaceCatalogOperationContracts[name];
    const envelope = await parseAuthDto(request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...storyWorkspaceCatalogSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      return runStoryWorkspaceCatalogOperation(name, envelope.input, principal, service.id, envelope.request_id, tx);
    });
  });
}
