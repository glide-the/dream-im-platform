// [Input] Configured Dream service, OAuth bearer and one Registry115 guidance envelope.
// [Output] Capability-gated guidance result from a single Admin transaction.
// [Pos] Thin OAuth-only ingress; all data authorization and persistence are server-owned.
// [Sync] 2026-09-15: expose Story Workspace guidance without generic Chat CRUD.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { principalForServiceToken } from "../auth/serviceAccessToken";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement } from "./schemaRequirements";
import { storyWorkspaceGuidanceOperationContracts, type StoryWorkspaceGuidanceOperation } from "./storyWorkspaceGuidanceDto";
import { runStoryWorkspaceGuidanceOperation, storyWorkspaceGuidanceSchemaRequirements } from "./storyWorkspaceGuidanceService";

export function isStoryWorkspaceGuidanceOperation(name: string): name is StoryWorkspaceGuidanceOperation {
  return Object.hasOwn(storyWorkspaceGuidanceOperationContracts, name);
}

export async function handleStoryWorkspaceGuidance(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isStoryWorkspaceGuidanceOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = storyWorkspaceGuidanceOperationContracts[name];
    const envelope = await parseAuthDto(request,
      z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    return withDataTransaction([identitySchemaRequirement, ...storyWorkspaceGuidanceSchemaRequirements], async tx => {
      const principal = await principalForServiceToken(tx,
        request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "", service, operation.userScope);
      return runStoryWorkspaceGuidanceOperation(name, envelope.input, principal, service.id, envelope.request_id, tx);
    });
  });
}
