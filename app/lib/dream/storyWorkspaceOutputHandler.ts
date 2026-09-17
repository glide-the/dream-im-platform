// [Input] Configured Dream service, OAuth or exact Thread grant and Registry109 envelope.
// [Output] One capability-gated atomic Story Workspace output result with original receipt identity.
// [Pos] Thin Registry109 ingress; parsing, Runtime, filesystem and SSE remain in Dream.
// [Sync] 2026-09-15: bind the Thread before the DTO-Service-ORM persistence UOW.
import { z } from "zod";
import { AuthBoundaryError, requiredAuthValue } from "../auth/config";
import { requestIdDto } from "../auth/dto";
import { handleInternalAuthRequest, parseAuthDto } from "../auth/internalHandler";
import { withDataTransaction } from "./database";
import { identitySchemaRequirement, runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement } from "./schemaRequirements";
import { requireDataActor } from "./principal";
import { storyWorkspaceOutputOperationContracts, type StoryWorkspaceOutputOperation } from "./storyWorkspaceOutputDto";
import { runStoryWorkspaceOutputOperation, storyWorkspaceOutputSchemaRequirements } from "./storyWorkspaceOutputService";

export function isStoryWorkspaceOutputOperation(name: string): name is StoryWorkspaceOutputOperation {
  return Object.hasOwn(storyWorkspaceOutputOperationContracts, name);
}

export async function handleStoryWorkspaceOutput(request: Request, name: string) {
  return handleInternalAuthRequest(request, async (service, setRequestId) => {
    if (!isStoryWorkspaceOutputOperation(name)) throw new AuthBoundaryError("OPERATION_UNAVAILABLE", 404);
    const operation = storyWorkspaceOutputOperationContracts[name];
    const envelope = await parseAuthDto(request, z.strictObject({ request_id: requestIdDto, input: operation.input }),
      Number(requiredAuthValue("DREAM_DATA_MAX_BODY_BYTES")));
    setRequestId(envelope.request_id);
    const delegated = request.headers.get("authorization")?.startsWith("Bearer idg_");
    return withDataTransaction([identitySchemaRequirement, ...storyWorkspaceOutputSchemaRequirements,
      ...(delegated ? [runtimeDelegationSchemaRequirement, runtimePurposeSchemaRequirement] : [])], async tx => {
      const actor = await requireDataActor(tx, request.headers, service, operation.userScope, envelope.input.thread_id, undefined);
      return runStoryWorkspaceOutputOperation(name, envelope.input, actor, service.id, envelope.request_id, tx);
    });
  });
}
